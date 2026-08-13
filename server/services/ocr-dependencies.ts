import { commitJob } from '../core/commit.js';
import { deleteJob, listJobs, loadJob, saveJob } from '../core/job-store.js';
import { createDocumentDraftJob, createDraftJob } from '../core/pipeline.js';
import type { AppConfig } from '../core/types.js';
import { createOcrAdapterRegistry, type OcrAdapterRegistry } from '../ocr/adapters.js';
import { convertDocumentToMarkdown } from '../convert/anydoc.js';

export interface OcrDependencies {
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

export const defaultOcrDependencies: OcrDependencies = {
  createDraftJob, createDocumentDraftJob, convertDocumentToMarkdown, loadJob,
  listJobs, saveJob, deleteJob, commitJob, createAdapterRegistry: createOcrAdapterRegistry,
};
