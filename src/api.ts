import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import express from 'express';

import { commitJob } from '../server/core/commit.js';
import {
  deleteJob,
  listJobs,
  loadJob,
  saveJob,
} from '../server/core/job-store.js';
import {
  createDocumentDraftJob,
  createDraftJob,
} from '../server/core/pipeline.js';
import type { AppConfig, OcrAdapter } from '../server/core/types.js';
import type {
  DraftJob,
  DraftPage,
  EngineName,
  PageQualityWarning,
} from '../shared/ocr.js';
import type { OcrAdapterRegistry } from '../server/ocr/adapters.js';
import { createOcrAdapterRegistry } from '../server/ocr/adapters.js';
import {
  convertDocumentToMarkdown,
  DocumentConversionError,
  isAnydocSupportedExtension,
} from '../server/convert/anydoc.js';

interface ApiError extends Error {
  statusCode?: number;
}

export interface ApiDependencies {
  createDraftJob: typeof createDraftJob;
  createDocumentDraftJob: typeof createDocumentDraftJob;
  convertDocumentToMarkdown: typeof convertDocumentToMarkdown;
  loadJob: typeof loadJob;
  listJobs: typeof listJobs;
  saveJob: typeof saveJob;
  deleteJob: typeof deleteJob;
  commitJob: typeof commitJob;
  createAdapterRegistry: (config: AppConfig) => OcrAdapterRegistry;
}

const DEFAULT_DEPENDENCIES: ApiDependencies = {
  createDraftJob,
  createDocumentDraftJob,
  convertDocumentToMarkdown,
  loadJob,
  listJobs,
  saveJob,
  deleteJob,
  commitJob,
  createAdapterRegistry: createOcrAdapterRegistry,
};

export function createApiRouter(
  config: AppConfig,
  dependencies: Partial<ApiDependencies> = {},
) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const router = express.Router();

  router.get(
    '/pdfs',
    asyncHandler(async (_req, res) => {
      const pdfs = await listInboxPdfs(config.inboxPath);
      res.json({ pdfs });
    }),
  );

  router.get(
    '/documents',
    asyncHandler(async (_req, res) => {
      const documents = await listInboxDocuments(config.inboxPath);
      res.json({ documents });
    }),
  );

  router.post(
    '/jobs',
    asyncHandler(async (req, res) => {
      const file = readRequiredString(req.body?.file, 'file');
      const mode = readJobMode(req.body?.mode);
      const filePath = resolveInboxFilePath(config.inboxPath, file);

      await assertExistingFile(filePath, 404, `File not found: ${file}`);
      const isPdf = path.extname(file).toLowerCase() === '.pdf';
      if (!isPdf && mode !== 'document') {
        throw createError(400, 'Non-PDF files require mode: document');
      }
      const kind = isPdf && mode === 'pages' ? 'pdf-pages' : 'document';

      const existingJob = await findPendingReviewJobForFile(
        deps,
        config,
        filePath,
        kind,
      );
      if (existingJob) {
        res.status(200).json({ job: existingJob, resumed: true });
        return;
      }

      let job: DraftJob;
      try {
        job =
          kind === 'pdf-pages'
            ? await deps.createDraftJob(
                filePath,
                config,
                deps.createAdapterRegistry(config),
              )
            : await deps.createDocumentDraftJob(filePath, config);
      } catch (error) {
        throw documentConversionApiError(error);
      }
      await deps.saveJob(config, job);
      res.status(201).json({ job });
    }),
  );

  router.get(
    '/jobs/:id',
    asyncHandler(async (req, res) => {
      const job = await requireJob(deps, config, req.params.id);
      res.json({ job });
    }),
  );

  router.get(
    '/jobs/:id/pages/:page/preview',
    asyncHandler(async (req, res) => {
      const job = await requireJob(deps, config, req.params.id);
      const page = getPage(job, req.params.page);

      if (!page.imagePath) {
        throw createError(404, 'No preview image available for this page.');
      }
      await assertExistingFile(
        page.imagePath,
        404,
        `Preview not found for page ${page.pageNumber}`,
      );
      const previewPath = path.resolve(page.imagePath);
      res.sendFile(path.basename(previewPath), {
        root: path.dirname(previewPath),
      });
    }),
  );

  router.post(
    '/jobs/:id/pages/:page/rerun',
    asyncHandler(async (req, res) => {
      const job = await requireJob(deps, config, req.params.id);
      assertJobNotCommitted(job);
      const page = getPage(job, req.params.page);
      let result: {
        markdown: string;
        confidence?: number;
        figures?: DraftPage['figures'];
        layoutBlocks?: DraftPage['layoutBlocks'];
      };
      let engine: DraftPage['engine'];
      if (job.kind === 'document') {
        try {
          result = await deps.convertDocumentToMarkdown(job.sourceFilePath);
        } catch (error) {
          throw documentConversionApiError(error);
        }
        engine = 'anydoc';
      } else {
        const ocrEngine = readEngine(req.body?.engine);
        const adapter = deps.createAdapterRegistry(config).getAdapter(ocrEngine);
        result = await processPageForRerun(adapter, page.imagePath!, ocrEngine);
        engine = ocrEngine;
      }
      const qualityWarning = buildLowNativeCoverageWarning(
        page.nativeText,
        result.markdown,
        page.pageNumber,
      );
      const now = new Date().toISOString();

      page.markdown = result.markdown.trim();
      page.confidence = result.confidence;
      // Figures come from the PDF page, not the engine; keep them when the
      // reran adapter (e.g. nuextract3-ocr) does not supply its own.
      page.figures = result.figures ?? page.figures;
      page.layoutBlocks = result.layoutBlocks;
      page.engine = engine;
      page.accepted = false;
      page.status = 'pending';
      page.qualityWarnings = mergePageWarnings(page, qualityWarning);
      job.updatedAt = now;

      await deps.saveJob(config, job);

      res.json({ job, page });
    }),
  );

  router.post(
    '/jobs/:id/pages/:page/accept',
    asyncHandler(async (req, res) => {
      const job = await requireJob(deps, config, req.params.id);
      assertJobNotCommitted(job);
      const page = getPage(job, req.params.page);

      page.accepted = true;
      page.status = 'accepted';
      job.updatedAt = new Date().toISOString();

      await deps.saveJob(config, job);

      res.json({ job, page });
    }),
  );

  router.post(
    '/jobs/:id/commit',
    asyncHandler(async (req, res) => {
      const job = await requireJob(deps, config, req.params.id);
      assertJobNotCommitted(job);
      assertHasAcceptedPages(job);
      const result = await deps.commitJob(config, job);

      if (result.movedSourcePdf) {
        job.status = 'committed';
      }
      job.updatedAt = new Date().toISOString();
      await deps.saveJob(config, job);

      res.json({
        job,
        outputPath: result.outputDir,
        fullAccepted: result.movedSourcePdf,
      });
    }),
  );

  router.delete(
    '/jobs/:id',
    asyncHandler(async (req, res) => {
      const job = await deps.loadJob(config, req.params.id as string);
      if (!job) {
        throw createError(404, `Job not found: ${req.params.id}`);
      }
      assertJobNotCommitted(job);

      const deleted = await deps.deleteJob(config, req.params.id as string);
      await rm(path.join(config.jobStorePath, encodeURIComponent(job.id)), {
        recursive: true,
        force: true,
      });
      res.json({ deleted });
    }),
  );

  return router;
}

export function installJsonErrorHandler(app: express.Express): void {
  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const statusCode = getStatusCode(error);
      const message = isApiError(error)
        ? getErrorMessage(error)
        : statusCode >= 500
          ? 'Internal server error'
          : getErrorMessage(error);

      // The client response is deliberately sanitized for 5xx (see message above),
      // so log full detail server-side — otherwise these failures vanish silently
      // and are undiagnosable (e.g. an unconfigured engine surfaces as a bare 500).
      if (statusCode >= 500) {
        const detail =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(
          `[api] ${req.method} ${req.originalUrl} -> ${statusCode}: ${detail}`,
        );
      }

      res.status(statusCode).json({ error: message });
    },
  );
}

async function listInboxPdfs(inboxPath: string): Promise<string[]> {
  try {
    const entries = await readdir(inboxPath, { withFileTypes: true });

    return entries
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function listInboxDocuments(inboxPath: string): Promise<string[]> {
  try {
    const entries = await readdir(inboxPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && isAnydocSupportedExtension(entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function resolveInboxFilePath(inboxPath: string, file: string): string {
  if (path.basename(file) !== file || file.includes('/') || file.includes('\\')) {
    throw createError(400, 'file must be inbox filename only');
  }

  const resolvedInboxPath = path.resolve(inboxPath);
  const resolvedFilePath = path.resolve(resolvedInboxPath, file);
  const relativePath = path.relative(resolvedInboxPath, resolvedFilePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw createError(400, 'file must stay within inboxPath');
  }

  return resolvedFilePath;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createError(400, `${field} must be non-empty string`);
  }

  return value.trim();
}

function readJobMode(value: unknown): 'pages' | 'document' {
  if (value === undefined) {
    return 'pages';
  }
  if (value !== 'pages' && value !== 'document') {
    throw createError(400, 'mode must be pages or document');
  }
  return value;
}

function readEngine(value: unknown): EngineName {
  const engine = readRequiredString(value, 'engine');
  if (
    engine !== 'tesseract' &&
    engine !== 'deepseek-ocr' &&
    engine !== 'glm-ocr' &&
    engine !== 'nuextract3-ocr'
  ) {
    throw createError(400, `Unsupported engine: ${engine}`);
  }

  return engine;
}

async function findPendingReviewJobForFile(
  deps: ApiDependencies,
  config: AppConfig,
  filePath: string,
  kind: DraftJob['kind'],
): Promise<DraftJob | null> {
  const jobs = await deps.listJobs(config);

  return (
    jobs
      .filter(
        (job) =>
          job.status === 'pending_review' &&
          job.kind === kind &&
          path.resolve(job.sourceFilePath) === path.resolve(filePath),
      )
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null
  );
}

function documentConversionApiError(error: unknown): ApiError | unknown {
  if (error instanceof DocumentConversionError) {
    return createError(error.status, error.message);
  }
  return error;
}

async function requireJob(
  deps: ApiDependencies,
  config: AppConfig,
  jobId: string | string[],
): Promise<DraftJob> {
  jobId = Array.isArray(jobId) ? jobId[0] ?? '' : jobId;
  const job = await deps.loadJob(config, jobId);
  if (!job) {
    throw createError(404, `Job not found: ${jobId}`);
  }

  return job;
}

function getPage(job: DraftJob, pageParam: string | string[]) {
  pageParam = Array.isArray(pageParam) ? pageParam[0] ?? '' : pageParam;
  const pageNumber = Number.parseInt(pageParam, 10);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw createError(400, 'page must be positive integer');
  }

  const page = job.pages.find(
    (candidate) => candidate.pageNumber === pageNumber,
  );
  if (!page) {
    throw createError(404, `Page not found: ${pageNumber}`);
  }

  return page;
}

function assertJobNotCommitted(job: DraftJob): void {
  if (job.status === 'committed') {
    throw createError(409, `Job already committed: ${job.id}`);
  }
}

function assertHasAcceptedPages(job: DraftJob): void {
  if (!job.pages.some((page) => page.accepted)) {
    throw createError(
      409,
      'Cannot commit job without at least one accepted page',
    );
  }
}

function buildLowNativeCoverageWarning(
  nativeText: string,
  markdown: string,
  pageNumber: number,
): PageQualityWarning | null {
  const nativeTokens = significantTokens(nativeText);
  if (nativeTokens.length < 80) {
    return null;
  }

  const markdownTokenSet = new Set(significantTokens(markdown));
  const covered = nativeTokens.filter((token) =>
    markdownTokenSet.has(token),
  ).length;
  const coverage = covered / nativeTokens.length;

  if (coverage < 0.6) {
    return {
      type: 'low-native-coverage',
      severity: 'warning',
      message: `OCR rerun for page ${pageNumber} may be incomplete (${Math.round(coverage * 100)}% native token coverage). Compare with native text before accepting.`,
      coverage,
      missingSnippets: collectMissingSnippets(nativeText, markdownTokenSet),
    };
  }

  return null;
}

function significantTokens(value: string): string[] {
  return (
    value
      .toLowerCase()
      .replace(/[’']/g, '')
      .match(/[a-z0-9]{5,}/g) ?? []
  );
}

function mergePageWarnings(
  page: DraftPage,
  qualityWarning: PageQualityWarning | null,
): PageQualityWarning[] | undefined {
  const retainedWarnings = (page.qualityWarnings ?? []).filter(
    (warning) => warning.type !== 'low-native-coverage',
  );

  if (qualityWarning) {
    retainedWarnings.push(qualityWarning);
  }

  return retainedWarnings.length > 0 ? retainedWarnings : undefined;
}

function collectMissingSnippets(
  markdownTokenSet: Set<string>,
  nativeText: string,
): string[];
function collectMissingSnippets(
  nativeText: string,
  markdownTokenSet: Set<string>,
): string[];
function collectMissingSnippets(
  first: string | Set<string>,
  second: string | Set<string>,
): string[] {
  const nativeText = typeof first === 'string' ? first : (second as string);
  const markdownTokenSet =
    first instanceof Set ? first : (second as Set<string>);
  const chunks = nativeText
    .split(/\n\s*\n|(?<=[.!?])\s+/)
    .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((chunk) => splitLongChunk(chunk));

  const scored = chunks
    .map((chunk, index) => {
      const tokens = significantTokens(chunk);
      if (!tokens.length) {
        return null;
      }

      const covered = tokens.filter((token) =>
        markdownTokenSet.has(token),
      ).length;
      const coverage = covered / tokens.length;

      return {
        chunk,
        index,
        coverage,
        missingCount: tokens.length - covered,
      };
    })
    .filter(
      (
        value,
      ): value is {
        chunk: string;
        index: number;
        coverage: number;
        missingCount: number;
      } => value !== null,
    )
    .filter((chunk) => chunk.coverage < 0.6)
    .sort((left, right) => {
      if (left.coverage !== right.coverage) {
        return left.coverage - right.coverage;
      }

      if (left.missingCount !== right.missingCount) {
        return right.missingCount - left.missingCount;
      }

      return left.index - right.index;
    })
    .slice(0, 3);

  return scored.map(({ chunk }) => truncateSnippet(chunk));
}

function truncateSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137).trimEnd()}...`;
}

function splitLongChunk(chunk: string): string[] {
  const words = chunk.split(/\s+/).filter(Boolean);
  if (words.length <= 12) {
    return [chunk];
  }

  const windows: string[] = [];
  for (let index = 0; index < words.length; index += 12) {
    windows.push(words.slice(index, index + 12).join(' '));
  }

  return windows;
}

async function processPageForRerun(
  adapter: OcrAdapter,
  imagePath: string,
  engine: EngineName,
) {
  try {
    return await adapter.processPage(imagePath, { mode: 'markdown' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown OCR error';
    throw createError(502, `OCR rerun failed for ${engine}: ${reason}`);
  }
}

async function assertExistingFile(
  filePath: string,
  statusCode: number,
  message: string,
): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw createError(statusCode, message);
    }

    throw error;
  }
}

function asyncHandler(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createError(statusCode: number, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  return error;
}

function getStatusCode(error: unknown): number {
  if (isApiError(error)) {
    const statusCode = (error as ApiError).statusCode;
    if (typeof statusCode === 'number') {
      return statusCode;
    }
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return 400;
  }

  return 500;
}

function isApiError(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Internal server error';
}
