import { describe, expect, it } from 'vitest';
import { nextReviewPageNumber, rerunRequest, reviewEngine, type ReviewJob } from '../utils/review';

const pdfJob: ReviewJob = {
  id: 'job-1',
  kind: 'pdf-pages',
  status: 'pending_review',
  sourceFilePath: '/inbox/report.pdf',
  pages: [
    { pageNumber: 1, accepted: true, status: 'accepted', markdown: '', engine: 'native' },
    { pageNumber: 2, accepted: false, status: 'pending', markdown: '', engine: 'deepseek-ocr' },
  ],
};

describe('OCR review state helpers', () => {
  it('continues review at the first unaccepted page', () => {
    expect(nextReviewPageNumber(pdfJob)).toBe(2);
    expect(nextReviewPageNumber({ ...pdfJob, pages: [] })).toBeNull();
  });

  it('keeps the selected adapter and avoids native document adapters', () => {
    expect(reviewEngine(pdfJob, pdfJob.pages[1])).toBe('deepseek-ocr');
    expect(reviewEngine(pdfJob, pdfJob.pages[1], 'glm-ocr')).toBe('glm-ocr');
    expect(reviewEngine({ ...pdfJob, kind: 'document' }, pdfJob.pages[0])).toBe('tesseract');
  });

  it('sends the selected OCR adapter while leaving document reconversion bodyless', () => {
    const [url, pdfRequest] = rerunRequest(pdfJob, pdfJob.pages[1], 'glm-ocr');
    expect(url).toBe('/api/jobs/job-1/pages/2/rerun');
    expect(pdfRequest).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine: 'glm-ocr' }),
    });

    const [, documentRequest] = rerunRequest({ ...pdfJob, kind: 'document' }, pdfJob.pages[0], 'tesseract');
    expect(documentRequest).toEqual({ method: 'POST' });
  });
});
