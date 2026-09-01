import { constants } from 'node:fs';
import { open, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { DocumentConversionError, isAnydocSupportedExtension } from '../convert/anydoc.js';
import type { AppConfig, OcrAdapter } from '../core/types.js';
import type { DraftJob, DraftPage, EngineName, PageQualityWarning } from '../../shared/ocr.js';
import { createApiError } from '../utils/api-errors.js';
import { defaultOcrDependencies, type OcrDependencies } from './ocr-dependencies.js';

export interface PreviewFile { data: Buffer; contentType: string; }
export interface OcrService {
  listPdfs(): Promise<string[]>; listDocuments(): Promise<string[]>;
  createJob(body: unknown): Promise<{ job: DraftJob; resumed?: true; statusCode: 200 | 201 }>;
  getJob(id: string): Promise<DraftJob>; getPreview(id: string, page: string): Promise<PreviewFile>;
  rerun(id: string, page: string, body: unknown): Promise<{ job: DraftJob; page: DraftPage }>;
  accept(id: string, page: string): Promise<{ job: DraftJob; page: DraftPage }>;
  commit(id: string): Promise<{ job: DraftJob; outputPath: string; fullAccepted: boolean }>;
  delete(id: string): Promise<{ deleted: boolean }>;
}

export function createOcrService(config: AppConfig, overrides: Partial<OcrDependencies> = {}): OcrService {
  const deps = { ...defaultOcrDependencies, ...overrides };
  return {
    listPdfs: () => listInbox(config.inboxPath, (name) => name.toLowerCase().endsWith('.pdf')),
    listDocuments: () => listInbox(config.inboxPath, isAnydocSupportedExtension),
    async createJob(body) {
      const record = object(body); const file = requiredString(record.file, 'file'); const mode = jobMode(record.mode);
      const filePath = resolveInboxFile(config.inboxPath, file); await existingFile(filePath, 404, `File not found: ${file}`);
      const isPdf = path.extname(file).toLowerCase() === '.pdf';
      if (!isPdf && mode !== 'document') throw createApiError(400, 'Non-PDF files require mode: document');
      const kind = isPdf && mode === 'pages' ? 'pdf-pages' : 'document';
      const existing = await pendingJob(deps, config, filePath, kind);
      if (existing) return { job: existing, resumed: true, statusCode: 200 };
      try {
        const job = kind === 'pdf-pages' ? await deps.createDraftJob(filePath, config, deps.createAdapterRegistry(config)) : await deps.createDocumentDraftJob(filePath, config);
        await deps.saveJob(config, job); return { job, statusCode: 201 };
      } catch (error) { throw conversionError(error); }
    },
    getJob: (id) => requireJob(deps, config, id),
    async getPreview(id, number) {
      const job = await requireJob(deps, config, id); const page = pageFor(job, number);
      if (!page.imagePath) throw createApiError(404, 'No preview image available for this page.');
      return openPreview(config, job.id, page.imagePath, page.pageNumber);
    },
    async rerun(id, number, body) {
      const job = await requireJob(deps, config, id); notCommitted(job); const page = pageFor(job, number);
      let result: { markdown: string; confidence?: number; figures?: DraftPage['figures']; layoutBlocks?: DraftPage['layoutBlocks'] }; let engine: DraftPage['engine']; let availableOutputFormats: DraftPage['availableOutputFormats'];
      if (job.kind === 'document') { try { result = await deps.convertDocumentToMarkdown(job.sourceFilePath); } catch (error) { throw conversionError(error); } engine = 'anydoc'; availableOutputFormats = ['markdown']; }
      else { const selected = engineName(object(body).engine); const adapter = deps.createAdapterRegistry(config).getAdapter(selected); result = await rerunPage(adapter, page.imagePath!, selected); engine = selected; availableOutputFormats = [...(adapter.capabilities?.outputFormats ?? ['markdown'])]; }
      const warning = coverageWarning(page.nativeText, result.markdown, page.pageNumber);
      if (engine === 'deepseek-ocr-vlm' && warning && hasCollapsedWordBoundaries(result.markdown)) {
        throw createApiError(502, 'DeepSeek OCR returned text without word boundaries; the page was not changed.');
      }
      page.markdown = result.markdown.trim(); page.outputFormat = 'markdown'; page.availableOutputFormats = availableOutputFormats; page.confidence = result.confidence; page.figures = result.figures ?? page.figures; page.layoutBlocks = result.layoutBlocks; page.engine = engine; page.accepted = false; page.status = 'pending'; page.qualityWarnings = mergeWarnings(page, warning); job.updatedAt = new Date().toISOString(); await deps.saveJob(config, job); return { job, page };
    },
    async accept(id, number) { const job = await requireJob(deps, config, id); notCommitted(job); const page = pageFor(job, number); page.accepted = true; page.status = 'accepted'; job.updatedAt = new Date().toISOString(); await deps.saveJob(config, job); return { job, page }; },
    async commit(id) { const job = await requireJob(deps, config, id); notCommitted(job); if (!job.pages.some((page) => page.accepted)) throw createApiError(409, 'Cannot commit job without at least one accepted page'); const result = await deps.commitJob(config, job); if (result.movedSourcePdf) job.status = 'committed'; job.updatedAt = new Date().toISOString(); await deps.saveJob(config, job); return { job, outputPath: result.outputDir, fullAccepted: result.movedSourcePdf }; },
    async delete(id) { const job = await requireJob(deps, config, id); notCommitted(job); const deleted = await deps.deleteJob(config, id); await rm(path.join(config.jobStorePath, encodeURIComponent(job.id)), { recursive: true, force: true }); return { deleted }; },
  };
}

async function listInbox(inbox: string, matches: (name: string) => boolean): Promise<string[]> { try { return (await readdir(inbox, { withFileTypes: true })).filter((entry) => entry.isFile() && matches(entry.name)).map((entry) => entry.name).sort((a, b) => a.localeCompare(b)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } }
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function requiredString(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw createApiError(400, `${name} must be non-empty string`); return value.trim(); }
function jobMode(value: unknown): 'pages' | 'document' { if (value === undefined) return 'pages'; if (value !== 'pages' && value !== 'document') throw createApiError(400, 'mode must be pages or document'); return value; }
function engineName(value: unknown): EngineName { const engine = requiredString(value, 'engine'); if (!['tesseract', 'deepseek-ocr', 'deepseek-ocr-vlm', 'glm-ocr', 'nuextract3-ocr'].includes(engine)) throw createApiError(400, `Unsupported engine: ${engine}`); return engine as EngineName; }
function resolveInboxFile(inbox: string, file: string): string { if (path.basename(file) !== file || file.includes('/') || file.includes('\\')) throw createApiError(400, 'file must be inbox filename only'); const root = path.resolve(inbox); const resolved = path.resolve(root, file); const relative = path.relative(root, resolved); if (relative.startsWith('..') || path.isAbsolute(relative)) throw createApiError(400, 'file must stay within inboxPath'); return resolved; }
async function existingFile(file: string, status: number, message: string): Promise<void> { try { const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { if (!(await handle.stat()).isFile()) throw createApiError(status, message); } finally { await handle.close(); } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ELOOP') throw createApiError(status, message); throw error; } }
async function pendingJob(deps: OcrDependencies, config: AppConfig, file: string, kind: DraftJob['kind']): Promise<DraftJob | null> { return (await deps.listJobs(config)).filter((job) => job.status === 'pending_review' && job.kind === kind && path.resolve(job.sourceFilePath) === path.resolve(file)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null; }
function conversionError(error: unknown): unknown { return error instanceof DocumentConversionError ? createApiError(error.status, error.message) : error; }
async function requireJob(deps: OcrDependencies, config: AppConfig, id: string): Promise<DraftJob> { const job = await deps.loadJob(config, id); if (!job) throw createApiError(404, `Job not found: ${id}`); return job; }
function pageFor(job: DraftJob, value: string): DraftPage { const number = Number.parseInt(value, 10); if (!Number.isInteger(number) || number < 1) throw createApiError(400, 'page must be positive integer'); const page = job.pages.find((item) => item.pageNumber === number); if (!page) throw createApiError(404, `Page not found: ${number}`); return page; }
function notCommitted(job: DraftJob): void { if (job.status === 'committed') throw createApiError(409, `Job already committed: ${job.id}`); }
async function rerunPage(adapter: OcrAdapter, imagePath: string, engine: EngineName) { try { return await adapter.processPage(imagePath, { mode: 'markdown' }); } catch (error) { throw createApiError(502, `OCR rerun failed for ${engine}: ${error instanceof Error ? error.message : 'unknown OCR error'}`); } }
function words(value: string): string[] { return value.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]{5,}/g) ?? []; }
function hasCollapsedWordBoundaries(value: string): boolean { return /[\p{L}\p{N}]{40,}/u.test(value); }
function coverageWarning(nativeText: string, markdown: string, pageNumber: number): PageQualityWarning | null { const native = words(nativeText); if (native.length < 80) return null; const found = new Set(words(markdown)); const coverage = native.filter((word) => found.has(word)).length / native.length; if (coverage >= .6) return null; return { type: 'low-native-coverage', severity: 'warning', message: `OCR rerun for page ${pageNumber} may be incomplete (${Math.round(coverage * 100)}% native token coverage). Compare with native text before accepting.`, coverage, missingSnippets: missingSnippets(nativeText, found) }; }
function mergeWarnings(page: DraftPage, warning: PageQualityWarning | null): PageQualityWarning[] | undefined { const warnings = (page.qualityWarnings ?? []).filter((item) => item.type !== 'low-native-coverage'); if (warning) warnings.push(warning); return warnings.length ? warnings : undefined; }
function missingSnippets(nativeText: string, found: Set<string>): string[] { return nativeText.split(/\n\s*\n|(?<=[.!?])\s+/).flatMap((value) => { const text = value.replace(/\s+/g, ' ').trim(); const all = text.split(/\s+/); return all.length <= 12 ? [text] : Array.from({ length: Math.ceil(all.length / 12) }, (_, index) => all.slice(index * 12, index * 12 + 12).join(' ')); }).map((chunk, index) => ({ chunk, index, tokens: words(chunk) })).filter((item) => item.tokens.length).map((item) => ({ ...item, coverage: item.tokens.filter((word) => found.has(word)).length / item.tokens.length })).filter((item) => item.coverage < .6).sort((a,b) => a.coverage - b.coverage || a.index - b.index).slice(0, 3).map((item) => item.chunk.length <= 140 ? item.chunk : `${item.chunk.slice(0, 137).trimEnd()}...`); }
async function openPreview(config: AppConfig, jobId: string, previewPath: string, pageNumber: number): Promise<PreviewFile> { const directory = path.join(config.jobStorePath, encodeURIComponent(jobId), 'previews'); const canonicalDirectory = await safeRealpath(directory, pageNumber); const canonicalPreview = await safeRealpath(previewPath, pageNumber); const relative = path.relative(canonicalDirectory, canonicalPreview); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw createApiError(404, `Preview not found for page ${pageNumber}`); let handle; try { handle = await open(canonicalPreview, constants.O_RDONLY | constants.O_NOFOLLOW); const stat = await handle.stat(); if (!stat.isFile()) throw createApiError(404, `Preview not found for page ${pageNumber}`); return { data: await handle.readFile(), contentType: previewContentType(canonicalPreview) }; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ELOOP') throw createApiError(404, `Preview not found for page ${pageNumber}`); throw error; } finally { await handle?.close(); } }
async function safeRealpath(value: string, pageNumber: number): Promise<string> { try { return await realpath(value); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw createApiError(404, `Preview not found for page ${pageNumber}`); throw error; } }
function previewContentType(file: string): string { switch (path.extname(file).toLowerCase()) { case '.jpg': case '.jpeg': return 'image/jpeg'; case '.webp': return 'image/webp'; default: return 'image/png'; } }
