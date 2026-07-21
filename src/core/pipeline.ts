import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { OcrAdapterRegistry } from '../ocr/adapters.js';
import { createOcrAdapterRegistry } from '../ocr/adapters.js';
import { saveJob } from './job-store.js';
import { extractPdfPages } from './pdf.js';
import type { AppConfig, DraftJob, DraftPage, OcrAdapter } from './types.js';

export interface CreateDraftJobOptions {
  persist?: boolean;
  now?: Date;
}

export async function createDraftJob(
  pdfPath: string,
  config: AppConfig,
  adapterRegistry: OcrAdapterRegistry = createOcrAdapterRegistry(config),
  options: CreateDraftJobOptions = {}
): Promise<DraftJob> {
  assertPdfPathWithinInbox(pdfPath, config.inboxPath);

  const jobId = randomUUID();
  const timestamp = (options.now ?? new Date()).toISOString();
  const jobDir = path.join(config.jobStorePath, encodeURIComponent(jobId));
  const previewDir = path.join(jobDir, 'previews');

  await mkdir(previewDir, { recursive: true });

  const extractedPages = await extractPdfPages(pdfPath, { previewDir });
  const defaultAdapter = adapterRegistry.getDefaultAdapter();
  const pages: DraftPage[] = [];

  for (const extractedPage of extractedPages) {
    pages.push(await createDraftPage(extractedPage, config, defaultAdapter));
  }

  const job: DraftJob = {
    id: jobId,
    sourcePdfPath: pdfPath,
    status: 'pending_review',
    createdAt: timestamp,
    updatedAt: timestamp,
    pages
  };

  if (options.persist ?? true) {
    await saveJob(config, job);
  }

  return job;
}

function assertPdfPathWithinInbox(pdfPath: string, inboxPath: string): void {
  const resolvedInboxPath = path.resolve(inboxPath);
  const resolvedPdfPath = path.resolve(pdfPath);
  const relativePath = path.relative(resolvedInboxPath, resolvedPdfPath);

  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`PDF path must stay within inboxPath: ${resolvedPdfPath}`);
  }
}

async function createDraftPage(
  extractedPage: Awaited<ReturnType<typeof extractPdfPages>>[number],
  config: AppConfig,
  adapter: OcrAdapter
): Promise<DraftPage> {
  const nativeText = extractedPage.nativeText.trim();

  if (config.textExtractionMode === 'auto' && nativeText.length >= config.nativeTextMinChars) {
    return {
      pageNumber: extractedPage.pageNumber,
      imagePath: extractedPage.previewImagePath,
      nativeText,
      markdown: nativeText,
      accepted: false,
      status: 'pending',
      engine: 'native'
    };
  }

  let ocrResult: Awaited<ReturnType<OcrAdapter['processPage']>>;
  try {
    ocrResult = await adapter.processPage(extractedPage.previewImagePath, { mode: 'markdown' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      pageNumber: extractedPage.pageNumber,
      imagePath: extractedPage.previewImagePath,
      nativeText,
      markdown: `[[OCR FAILED: page ${extractedPage.pageNumber} - ${reason}]]`,
      accepted: false,
      status: 'failed',
      engine: adapter.name,
      qualityWarnings: [
        {
          type: 'ocr-failed',
          severity: 'warning',
          message: `Initial OCR failed for page ${extractedPage.pageNumber}: ${reason}`,
          coverage: 0,
          missingSnippets: []
        }
      ]
    };
  }

  return {
    pageNumber: extractedPage.pageNumber,
    imagePath: extractedPage.previewImagePath,
    nativeText,
    markdown: ocrResult.markdown.trim(),
    accepted: false,
    status: 'pending',
    engine: adapter.name,
    confidence: ocrResult.confidence,
    figures: ocrResult.figures,
    layoutBlocks: ocrResult.layoutBlocks
  };
}
