import { access, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { convertDocumentToMarkdown } from '../../convert/anydoc.js';
import { loadConfig } from '../../core/config.js';
import { createDraftJob } from '../../core/pipeline.js';
import { createOcrAdapterRegistry } from '../../ocr/adapters.js';
import {
  ensureProbeRtfTemp,
  pickFirstDocument,
  pickFirstPdf,
  resolveProbeConfigPath,
  withTimeout,
} from '../../utils/phase2-probe.js';

const PROBE_TIMEOUT_MS = 45_000;

type ProbePdfResult = {
  pageCount: number;
  previewBytes: number;
  firstPageEngine: string;
  firstPageMarkdownChars: number;
};

function throwNoPdfFound(): never {
  throw createError({
    statusCode: 422,
    statusMessage: 'No PDF found in inbox directory',
  });
}

function throwPreviewMissing(): never {
  throw createError({
    statusCode: 500,
    statusMessage: 'Preview generation failed for probe page',
  });
}

async function runPdfProbe(configPath: string): Promise<ProbePdfResult> {
  const config = loadConfig(configPath);
  const adapterRegistry = createOcrAdapterRegistry(config);

  const entries = await readdir(config.inboxPath);
  const pdfFile = pickFirstPdf(entries);
  if (!pdfFile) {
    throwNoPdfFound();
  }

  const pdfPath = path.join(config.inboxPath, pdfFile);
  const job = await withTimeout(
    createDraftJob(pdfPath, config, adapterRegistry, { persist: false }),
    PROBE_TIMEOUT_MS,
    'Phase 2 PDF probe timed out',
  );

  const firstPage = job.pages[0];
  if (!firstPage?.imagePath) {
    throwPreviewMissing();
  }

  await access(firstPage.imagePath);
  const previewBytes = (await readFile(firstPage.imagePath)).byteLength;

  return {
    pageCount: job.pages.length,
    previewBytes,
    firstPageEngine: firstPage.engine,
    firstPageMarkdownChars: firstPage.markdown.length,
  };
}

async function runDocumentProbe(
  configPath: string,
): Promise<{ markdownChars: number }> {
  const config = loadConfig(configPath);
  const entries = await readdir(config.inboxPath);
  const docFile = pickFirstDocument(entries);
  const docPath = docFile
    ? path.join(config.inboxPath, docFile)
    : await ensureProbeRtfTemp();
  const shouldCleanup = !docFile;

  try {
    const { markdown } = await withTimeout(
      convertDocumentToMarkdown(docPath),
      PROBE_TIMEOUT_MS,
      'Phase 2 anydoc probe timed out',
    );

    return { markdownChars: markdown.length };
  } finally {
    if (shouldCleanup) {
      await rm(docPath, { force: true });
    }
  }
}

export default defineEventHandler(async () => {
  try {
    const configPath = resolveProbeConfigPath();
    const config = loadConfig(configPath);
    const adapterRegistry = createOcrAdapterRegistry(config);
    const tesseract = adapterRegistry.getAdapter('tesseract');

    const pdf = await runPdfProbe(configPath);
    const anydoc = await runDocumentProbe(configPath);
    const tesseractAvailable = await tesseract.isAvailable();
    const tesseractConfig = config.engines.tesseract;
    const trainedDataPath =
      tesseractConfig?.kind === 'tesseract'
        ? (tesseractConfig.trainedDataPath ?? null)
        : null;

    return {
      ok: true,
      phase: 2,
      runtime: 'nuxt-nitro',
      pdf,
      tesseract: {
        available: tesseractAvailable,
        trainedDataPath,
      },
      anydoc,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error;
    }

    console.error('[phase2-probe] Unexpected error', error);
    throw createError({
      statusCode: 500,
      statusMessage: 'Phase 2 probe failed',
    });
  }
});
