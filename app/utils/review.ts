export interface QualityWarning {
  type: string;
  message: string;
  missingSnippets?: string[];
}

export interface ReviewPage {
  pageNumber: number;
  accepted: boolean;
  status: string;
  markdown: string;
  outputFormat?: 'markdown' | 'json' | 'html';
  availableOutputFormats?: Array<'markdown' | 'json' | 'html'>;
  engine: string;
  confidence?: number;
  qualityWarnings?: QualityWarning[];
}

export interface ReviewJob {
  id: string;
  kind: 'pdf-pages' | 'document';
  status: string;
  sourceFilePath: string;
  pages: ReviewPage[];
}

export function nextReviewPageNumber(job: ReviewJob): number | null {
  return job.pages.find((page) => !page.accepted)?.pageNumber ?? job.pages[0]?.pageNumber ?? null;
}

export function reviewEngine(job: ReviewJob | null, page: ReviewPage | null, storedEngine?: string): string {
  if (storedEngine) return storedEngine;
  if (!page || job?.kind === 'document' || page.engine === 'native') return 'tesseract';
  return page.engine;
}

export function rerunRequest(job: ReviewJob, page: ReviewPage, engine: string): [string, RequestInit] {
  const url = `/api/jobs/${encodeURIComponent(job.id)}/pages/${page.pageNumber}/rerun`;
  return job.kind === 'document'
    ? [url, { method: 'POST' }]
    : [
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ engine }),
        },
      ];
}
