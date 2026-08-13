import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOcrReview } from './useOcrReview';
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

describe('OCR review request failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['loading the inbox', (review: ReturnType<typeof useOcrReview>) => review.loadInbox()],
    ['creating a draft', (review: ReturnType<typeof useOcrReview>) => review.startJob('report.pdf', 'pages')],
    ['rerunning the review', (review: ReturnType<typeof useOcrReview>) => review.rerunCurrentPage()],
    ['accepting the review', (review: ReturnType<typeof useOcrReview>) => review.acceptCurrentPage()],
    ['committing accepted pages', (review: ReturnType<typeof useOcrReview>) => review.commitCurrentJob()],
    ['discarding the draft', (review: ReturnType<typeof useOcrReview>) => review.discardCurrentJob()],
  ] as const)('keeps a visible actionable error for %s failures', async (operation, run) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(apiFailure())));
    const review = useOcrReview();

    if (operation !== 'loading the inbox' && operation !== 'creating a draft') {
      review.job.value = structuredClone(pdfJob);
    }

    await run(review);

    expect(review.error.value).toEqual({
      operation,
      message: 'OCR service is unavailable.',
      recoveryAction: expect.any(String),
    });
    expect(review.status.value).not.toBe('OCR service is unavailable.');
  });

  it('removes the error only after acknowledgement or a successful request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(apiFailure())
      .mockResolvedValueOnce(apiSuccess({ job: structuredClone(pdfJob) }));
    vi.stubGlobal('fetch', fetch);
    const review = useOcrReview();

    await review.startJob('report.pdf', 'pages');
    expect(review.error.value).not.toBeNull();
    review.dismissError();
    expect(review.error.value).toBeNull();

    await review.startJob('report.pdf', 'pages');
    expect(review.error.value).toBeNull();
    expect(review.status.value).toBe('Draft ready for report.pdf.');
  });

  it('replaces unsafe server text with a generic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(apiFailure('Failed at /Users/example/inbox/report.pdf')),
    );
    const review = useOcrReview();

    await review.startJob('report.pdf', 'pages');

    expect(review.error.value?.message).toBe('Request failed with status 503.');
  });
});

function apiFailure(message = 'OCR service is unavailable.') {
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}

function apiSuccess(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
