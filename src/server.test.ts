import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AppConfig,
  OcrAdapter,
} from '../server/core/types.js';
import type { DraftJob, OcrResult } from '../shared/ocr.js';
import { createServer, loadListenerConfig } from './server.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-server-'));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(rootDir: string): AppConfig {
  return {
    inboxPath: path.join(rootDir, 'inbox'),
    jobStorePath: path.join(rootDir, '.ocrtool', 'jobs'),
    defaultEngine: 'tesseract',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      tesseract: {
        kind: 'tesseract',
        lang: 'eng',
      },
    },
  };
}

function makeJob(rootDir: string, overrides: Partial<DraftJob> = {}): DraftJob {
  const previewPath = path.join(
    rootDir,
    '.ocrtool',
    'jobs',
    'job-1',
    'previews',
    'page-0001.png',
  );
  mkdirSync(path.dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, 'preview');

  return {
    id: 'job-1',
    kind: 'pdf-pages',
    sourceFilePath: path.join(rootDir, 'inbox', 'report.pdf'),
    status: 'pending_review',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    pages: [
      {
        pageNumber: 1,
        imagePath: previewPath,
        nativeText: '',
        markdown: 'draft page',
        accepted: false,
        status: 'pending',
        engine: 'tesseract',
        confidence: 0.8,
      },
    ],
    ...overrides,
  };
}

async function withServer(
  app: ReturnType<typeof createServer>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createHttpServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('server api', () => {
  it('exposes glm-ocr in the review OCR adapter selector', () => {
    const html = readFileSync(path.resolve('app/components/Reviewer.vue'), 'utf8');

    expect(html).toContain('<option value="glm-ocr">glm-ocr</option>');
  });

  it('rejects non-local listener binding', () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);

    expect(() => createServer(config, undefined, {
      host: '0.0.0.0',
      port: 3000,
    })).toThrow(
      'host must be loopback/local only: 0.0.0.0',
    );
  });

  it('reads listener configuration from Nitro environment variables', () => {
    expect(loadListenerConfig({
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '14005',
    })).toEqual({
      host: '127.0.0.1',
      port: 14005,
    });
  });

  it('lists inbox pdfs, resumes pending review jobs, and creates jobs with filename containment', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    writeFileSync(path.join(config.inboxPath, 'b.pdf'), 'pdf');
    writeFileSync(path.join(config.inboxPath, 'a.PDF'), 'pdf');
    mkdirSync(path.join(config.inboxPath, 'processed'), { recursive: true });
    writeFileSync(path.join(config.inboxPath, 'processed', 'skip.pdf'), 'pdf');

    const createdJob = makeJob(rootDir, { id: 'created-job' });
    const resumedJob = makeJob(rootDir, {
      id: 'resumed-job',
      sourceFilePath: path.join(config.inboxPath, 'a.PDF'),
      updatedAt: '2026-07-13T00:01:00.000Z',
    });
    const createDraftJobMock = vi.fn(async () => createdJob);
    const listJobsMock = vi.fn(async () => [resumedJob]);
    const app = createServer(config, {
      createDraftJob: createDraftJobMock,
      listJobs: listJobsMock,
    });

    await withServer(app, async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/pdfs`);
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toEqual({ pdfs: ['a.PDF', 'b.pdf'] });

      const resumeResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'a.PDF' }),
      });

      expect(resumeResponse.status).toBe(200);
      expect(await resumeResponse.json()).toEqual({
        job: resumedJob,
        resumed: true,
      });

      const createResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'b.pdf' }),
      });

      expect(createResponse.status).toBe(201);
      expect(await createResponse.json()).toEqual({ job: createdJob });
      expect(createDraftJobMock).toHaveBeenCalledOnce();
      expect(listJobsMock).toHaveBeenCalledTimes(2);
      expect(createDraftJobMock).toHaveBeenCalledWith(
        path.join(config.inboxPath, 'b.pdf'),
        config,
        expect.any(Object),
      );

      const traversalResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: '../escape.pdf' }),
      });

      expect(traversalResponse.status).toBe(400);
      expect(await traversalResponse.json()).toEqual({
        error: 'file must be inbox filename only',
      });
    });
  });

  it('loads preview, reruns page, accepts, partially commits, fully commits, and still deletes pending jobs', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const job = makeJob(rootDir, { id: 'job-1' });
    const draftDeleteJob = makeJob(rootDir, { id: 'draft-delete-job' });
    const rerunResult: OcrResult = {
      markdown: 'rerun markdown',
      confidence: 0.91,
    };
    const processPageMock = vi.fn(async () => rerunResult);
    const saveJobMock = vi.fn(async () => undefined);
    job.pages = [
      job.pages[0]!,
      {
        pageNumber: 2,
        imagePath: path.join(
          rootDir,
          '.ocrtool',
          'jobs',
          'job-1',
          'previews',
          'page-0002.png',
        ),
        nativeText: '',
        markdown: 'second page',
        accepted: false,
        status: 'pending',
        engine: 'tesseract',
      },
    ];
    writeFileSync(job.pages[0]!.imagePath!, 'preview');
    writeFileSync(job.pages[1]!.imagePath!, 'preview-2');
    const commitJobMock = vi
      .fn()
      .mockResolvedValueOnce({
        outputDir: path.join(config.inboxPath, 'report'),
        markdownPath: path.join(config.inboxPath, 'report', 'report.md'),
        processedPdfPath: null,
        movedSourcePdf: false,
      })
      .mockResolvedValueOnce({
        outputDir: path.join(config.inboxPath, 'report'),
        markdownPath: path.join(config.inboxPath, 'report', 'report.md'),
        processedPdfPath: path.join(
          config.inboxPath,
          'processed',
          'report.pdf',
        ),
        movedSourcePdf: true,
      });
    const deleteJobMock = vi.fn(async () => true);
    const loadJobMock = vi.fn(async (_cfg, jobId: string) =>
      jobId === 'draft-delete-job' ? draftDeleteJob : job,
    );
    const app = createServer(config, {
      loadJob: loadJobMock,
      saveJob: saveJobMock,
      commitJob: commitJobMock,
      deleteJob: deleteJobMock,
      createAdapterRegistry: () => ({
        getDefaultAdapter: () => ({
          name: 'tesseract',
          isAvailable: async () => true,
          processPage: processPageMock,
        }),
        getAdapter: () => ({
          name: 'tesseract',
          isAvailable: async () => true,
          processPage: processPageMock,
        }),
        listAdapters: () => [],
      }),
    });

    await withServer(app, async (baseUrl) => {
      const loadResponse = await fetch(`${baseUrl}/api/jobs/job-1`);
      expect(loadResponse.status).toBe(200);
      expect((await loadResponse.json()).job.id).toBe('job-1');

      const previewResponse = await fetch(
        `${baseUrl}/api/jobs/job-1/pages/1/preview`,
      );
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.text()).toBe('preview');

      const rerunResponse = await fetch(
        `${baseUrl}/api/jobs/job-1/pages/1/rerun`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ engine: 'tesseract' }),
        },
      );
      expect(rerunResponse.status).toBe(200);
      expect(processPageMock).toHaveBeenCalledWith(job.pages[0]!.imagePath, {
        mode: 'markdown',
      });
      expect(job.pages[0]?.markdown).toBe('rerun markdown');
      expect(job.pages[0]?.confidence).toBe(0.91);
      expect(job.pages[0]?.accepted).toBe(false);
      expect(job.pages[0]?.qualityWarnings).toBeUndefined();

      const acceptResponse = await fetch(
        `${baseUrl}/api/jobs/job-1/pages/1/accept`,
        {
          method: 'POST',
        },
      );
      expect(acceptResponse.status).toBe(200);
      expect(job.pages[0]?.accepted).toBe(true);
      expect(job.pages[0]?.status).toBe('accepted');

      const commitResponse = await fetch(`${baseUrl}/api/jobs/job-1/commit`, {
        method: 'POST',
      });
      expect(commitResponse.status).toBe(200);
      expect(await commitResponse.json()).toMatchObject({
        outputPath: path.join(config.inboxPath, 'report'),
        fullAccepted: false,
      });
      expect(job.status).toBe('pending_review');

      const acceptSecondPageResponse = await fetch(
        `${baseUrl}/api/jobs/job-1/pages/2/accept`,
        {
          method: 'POST',
        },
      );
      expect(acceptSecondPageResponse.status).toBe(200);
      expect(job.pages[1]?.accepted).toBe(true);
      expect(job.pages[1]?.status).toBe('accepted');

      const commitResponseFinal = await fetch(
        `${baseUrl}/api/jobs/job-1/commit`,
        {
          method: 'POST',
        },
      );
      expect(commitResponseFinal.status).toBe(200);
      expect(await commitResponseFinal.json()).toMatchObject({
        outputPath: path.join(config.inboxPath, 'report'),
        fullAccepted: true,
      });
      expect(job.status).toBe('committed');

      const deleteResponse = await fetch(
        `${baseUrl}/api/jobs/draft-delete-job`,
        {
          method: 'DELETE',
        },
      );
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({ deleted: true });
      expect(deleteJobMock).toHaveBeenCalledWith(config, 'draft-delete-job');
    });

    expect(saveJobMock).toHaveBeenCalledTimes(5);
  });

  it('rejects commit without accepted pages and blocks mutation after commit', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const draftJob = makeJob(rootDir);
    const committedJob = makeJob(rootDir, {
      status: 'committed',
      pages: [
        {
          ...makeJob(rootDir).pages[0]!,
          accepted: true,
          status: 'accepted',
        },
      ],
    });
    const saveJobMock = vi.fn(async () => undefined);
    const processPageMock = vi.fn(async () => ({
      markdown: 'changed',
      confidence: 0.7,
    }));
    const commitJobMock = vi.fn(async () => ({
      outputDir: path.join(config.inboxPath, 'report'),
      markdownPath: path.join(config.inboxPath, 'report', 'report.md'),
      processedPdfPath: path.join(config.inboxPath, 'processed', 'report.pdf'),
      movedSourcePdf: true,
    }));
    const deleteJobMock = vi.fn(async () => true);
    const loadJobMock = vi.fn(async (_cfg, jobId: string) =>
      jobId === 'committed-job' ? committedJob : draftJob,
    );
    committedJob.id = 'committed-job';
    const initialCommittedPage = { ...committedJob.pages[0]! };

    const app = createServer(config, {
      loadJob: loadJobMock,
      saveJob: saveJobMock,
      commitJob: commitJobMock,
      deleteJob: deleteJobMock,
      createAdapterRegistry: () => ({
        getDefaultAdapter: () => ({
          name: 'tesseract',
          isAvailable: async () => true,
          processPage: processPageMock,
        }),
        getAdapter: () => ({
          name: 'tesseract',
          isAvailable: async () => true,
          processPage: processPageMock,
        }),
        listAdapters: () => [],
      }),
    });

    await withServer(app, async (baseUrl) => {
      const commitWithoutAccepted = await fetch(
        `${baseUrl}/api/jobs/job-1/commit`,
        {
          method: 'POST',
        },
      );
      expect(commitWithoutAccepted.status).toBe(409);
      expect(await commitWithoutAccepted.json()).toEqual({
        error: 'Cannot commit job without at least one accepted page',
      });
      expect(commitJobMock).not.toHaveBeenCalled();

      const rerunCommitted = await fetch(
        `${baseUrl}/api/jobs/committed-job/pages/1/rerun`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ engine: 'tesseract' }),
        },
      );
      expect(rerunCommitted.status).toBe(409);
      expect(await rerunCommitted.json()).toEqual({
        error: 'Job already committed: committed-job',
      });

      const acceptCommitted = await fetch(
        `${baseUrl}/api/jobs/committed-job/pages/1/accept`,
        {
          method: 'POST',
        },
      );
      expect(acceptCommitted.status).toBe(409);
      expect(await acceptCommitted.json()).toEqual({
        error: 'Job already committed: committed-job',
      });

      const commitCommitted = await fetch(
        `${baseUrl}/api/jobs/committed-job/commit`,
        {
          method: 'POST',
        },
      );
      expect(commitCommitted.status).toBe(409);
      expect(await commitCommitted.json()).toEqual({
        error: 'Job already committed: committed-job',
      });

      const deleteCommitted = await fetch(`${baseUrl}/api/jobs/committed-job`, {
        method: 'DELETE',
      });
      expect(deleteCommitted.status).toBe(409);
      expect(await deleteCommitted.json()).toEqual({
        error: 'Job already committed: committed-job',
      });
    });

    expect(processPageMock).not.toHaveBeenCalled();
    expect(saveJobMock).not.toHaveBeenCalled();
    expect(commitJobMock).not.toHaveBeenCalled();
    expect(deleteJobMock).not.toHaveBeenCalled();
    expect(committedJob.pages[0]).toEqual(initialCommittedPage);
  });

  it('returns json errors with useful status codes', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const app = createServer(config, {
      loadJob: vi.fn(async () => null),
    });

    await withServer(app, async (baseUrl) => {
      const missingJob = await fetch(`${baseUrl}/api/jobs/missing`);
      expect(missingJob.status).toBe(404);
      expect(await missingJob.json()).toEqual({
        error: 'Job not found: missing',
      });

      const badJson = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      expect(badJson.status).toBe(400);
      expect(await badJson.json()).toEqual({
        error: expect.stringContaining('JSON'),
      });
    });
  });

  it('returns generic message for unexpected internal errors', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = createServer(config, {
      loadJob: vi.fn(async () => {
        throw new Error(`ENOENT: secret path ${rootDir}/private/file`);
      }),
    });

    try {
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jobs/job-1`);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
          error: 'Internal server error',
        });
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs server-side detail for 5xx while keeping the client response sanitized', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = createServer(config, {
      loadJob: vi.fn(async () => {
        throw new Error('boom internal detail');
      }),
    });

    try {
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/jobs/job-1`);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
          error: 'Internal server error',
        });
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = String(errorSpy.mock.calls[0]?.[0]);
      expect(logged).toContain('GET /api/jobs/job-1');
      expect(logged).toContain('-> 500');
      expect(logged).toContain('boom internal detail');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns useful OCR rerun errors for adapter failures', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const job = makeJob(rootDir);
    const failingAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: vi.fn(async () => true),
      processPage: vi.fn(async () => {
        throw new Error('Tesseract requires engines.tesseract.trainedDataPath');
      }),
    };

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = createServer(config, {
      loadJob: vi.fn(async () => job),
      createAdapterRegistry: vi.fn(() => ({
        getDefaultAdapter: vi.fn(),
        getAdapter: vi.fn(() => failingAdapter),
        listConfiguredEngines: vi.fn(() => ['tesseract']),
        listAdapters: vi.fn(() => []),
      })),
    });

    try {
      await withServer(app, async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/jobs/job-1/pages/1/rerun`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: 'tesseract' }),
          },
        );

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
          error:
            'OCR rerun failed for tesseract: Tesseract requires engines.tesseract.trainedDataPath',
        });
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('saves OCR rerun output with warning when native coverage is low', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const nativeText = Array.from(
      { length: 120 },
      (_, index) => `nativeword${index}`,
    ).join(' ');
    const job = makeJob(rootDir, {
      pages: [
        {
          pageNumber: 1,
          imagePath: path.join(
            rootDir,
            '.ocrtool',
            'jobs',
            'job-1',
            'previews',
            'page-0001.png',
          ),
          nativeText,
          markdown: 'original markdown',
          accepted: false,
          status: 'pending',
          engine: 'native',
          qualityWarnings: [
            {
              type: 'low-native-coverage',
              severity: 'warning',
              message: 'stale warning',
              coverage: 0.1,
              missingSnippets: ['stale'],
            },
          ],
        },
      ],
    });
    mkdirSync(path.dirname(job.pages[0]!.imagePath!), { recursive: true });
    writeFileSync(job.pages[0]!.imagePath!, 'preview');
    const saveJobMock = vi.fn(async () => undefined);
    const lossyAdapter: OcrAdapter = {
      name: 'deepseek-ocr',
      isAvailable: vi.fn(async () => true),
      processPage: vi.fn(async () => ({
        markdown: 'short OCR output without native coverage',
      })),
    };

    const app = createServer(config, {
      loadJob: vi.fn(async () => job),
      saveJob: saveJobMock,
      createAdapterRegistry: vi.fn(() => ({
        getDefaultAdapter: vi.fn(),
        getAdapter: vi.fn(() => lossyAdapter),
        listConfiguredEngines: vi.fn(() => ['deepseek-ocr']),
        listAdapters: vi.fn(() => []),
      })),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/pages/1/rerun`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ engine: 'deepseek-ocr' }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.page.markdown).toBe(
        'short OCR output without native coverage',
      );
      expect(payload.page.accepted).toBe(false);
      expect(payload.page.status).toBe('pending');
      expect(payload.page.qualityWarnings).toEqual([
        {
          type: 'low-native-coverage',
          severity: 'warning',
          message: expect.stringContaining('may be incomplete'),
          coverage: expect.any(Number),
          missingSnippets: [
            'nativeword0 nativeword1 nativeword2 nativeword3 nativeword4 nativeword5 nativeword6 nativeword7 nativeword8 nativeword9 nativeword10 nati...',
            'nativeword12 nativeword13 nativeword14 nativeword15 nativeword16 nativeword17 nativeword18 nativeword19 nativeword20 nativeword21 nativew...',
            'nativeword24 nativeword25 nativeword26 nativeword27 nativeword28 nativeword29 nativeword30 nativeword31 nativeword32 nativeword33 nativew...',
          ],
        },
      ]);
      expect(job.pages[0]?.markdown).toBe(
        'short OCR output without native coverage',
      );
      expect(saveJobMock).toHaveBeenCalledOnce();
    });
  });

  it('clears stale low-native-coverage warning when rerun coverage is okay or native text short', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const nativeText = Array.from(
      { length: 120 },
      (_, index) => `nativeword${index}`,
    ).join(' ');
    const job = makeJob(rootDir, {
      pages: [
        {
          pageNumber: 1,
          imagePath: path.join(
            rootDir,
            '.ocrtool',
            'jobs',
            'job-1',
            'previews',
            'page-0001.png',
          ),
          nativeText,
          markdown: 'before',
          accepted: false,
          status: 'pending',
          engine: 'native',
          qualityWarnings: [
            {
              type: 'low-native-coverage',
              severity: 'warning',
              message: 'stale warning',
              coverage: 0.2,
              missingSnippets: ['stale'],
            },
          ],
        },
        {
          pageNumber: 2,
          imagePath: path.join(
            rootDir,
            '.ocrtool',
            'jobs',
            'job-1',
            'previews',
            'page-0002.png',
          ),
          nativeText: 'short native text',
          markdown: 'before short',
          accepted: false,
          status: 'pending',
          engine: 'native',
          qualityWarnings: [
            {
              type: 'low-native-coverage',
              severity: 'warning',
              message: 'stale warning',
              coverage: 0.2,
              missingSnippets: ['stale'],
            },
          ],
        },
      ],
    });
    mkdirSync(path.dirname(job.pages[0]!.imagePath!), { recursive: true });
    writeFileSync(job.pages[0]!.imagePath!, 'preview');
    writeFileSync(job.pages[1]!.imagePath!, 'preview-2');
    const saveJobMock = vi.fn(async () => undefined);
    const goodAdapter: OcrAdapter = {
      name: 'deepseek-ocr',
      isAvailable: vi.fn(async () => true),
      processPage: vi
        .fn()
        .mockResolvedValueOnce({ markdown: nativeText })
        .mockResolvedValueOnce({
          markdown: 'totally different but short native page',
        }),
    };

    const app = createServer(config, {
      loadJob: vi.fn(async () => job),
      saveJob: saveJobMock,
      createAdapterRegistry: vi.fn(() => ({
        getDefaultAdapter: vi.fn(),
        getAdapter: vi.fn(() => goodAdapter),
        listConfiguredEngines: vi.fn(() => ['deepseek-ocr']),
        listAdapters: vi.fn(() => []),
      })),
    });

    await withServer(app, async (baseUrl) => {
      const responseOne = await fetch(
        `${baseUrl}/api/jobs/job-1/pages/1/rerun`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ engine: 'deepseek-ocr' }),
        },
      );
      expect(responseOne.status).toBe(200);
      expect((await responseOne.json()).page.qualityWarnings).toBeUndefined();

      const responseTwo = await fetch(
        `${baseUrl}/api/jobs/job-1/pages/2/rerun`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ engine: 'deepseek-ocr' }),
        },
      );
      expect(responseTwo.status).toBe(200);
      expect((await responseTwo.json()).page.qualityWarnings).toBeUndefined();
    });

    expect(saveJobMock).toHaveBeenCalledTimes(2);
  });

  it('lists supported documents while excluding pdf, csv, and unsupported files', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    for (const file of [
      'report.docx',
      'slides.PPTX',
      'notes.rtf',
      'scan.pdf',
      'data.csv',
      'readme.txt',
    ]) {
      writeFileSync(path.join(config.inboxPath, file), file);
    }

    const app = createServer(config);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/documents`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        documents: ['notes.rtf', 'report.docx', 'slides.PPTX'],
      });
    });
  });

  it('persists document jobs and resumes pending conversion jobs', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    const documentPath = path.join(config.inboxPath, 'x.docx');
    writeFileSync(documentPath, 'document');
    const documentJob = makeJob(rootDir, {
      id: 'document-job',
      kind: 'document',
      sourceFilePath: documentPath,
      pages: [
        {
          pageNumber: 1,
          nativeText: '',
          markdown: 'converted',
          accepted: false,
          status: 'pending',
          engine: 'anydoc',
        },
      ],
    });
    const convertDocumentToMarkdown = vi.fn(async (_filePath: string) => ({
      markdown: 'converted',
    }));
    const createDocumentDraftJob = vi.fn(async (filePath: string) => {
      await convertDocumentToMarkdown(filePath);
      return documentJob;
    });
    const app = createServer(config, {
      createDocumentDraftJob,
      convertDocumentToMarkdown,
    });

    await withServer(app, async (baseUrl) => {
      const firstResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'x.docx', mode: 'document' }),
      });
      expect(firstResponse.status).toBe(201);
      expect(await firstResponse.json()).toEqual({ job: documentJob });

      const loadedResponse = await fetch(
        `${baseUrl}/api/jobs/${documentJob.id}`,
      );
      expect(loadedResponse.status).toBe(200);
      expect((await loadedResponse.json()).job).toEqual(documentJob);

      const secondResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'x.docx', mode: 'document' }),
      });
      expect(secondResponse.status).toBe(200);
      expect(await secondResponse.json()).toEqual({
        job: documentJob,
        resumed: true,
      });
    });
    expect(createDocumentDraftJob).toHaveBeenCalledWith(documentPath, config);
    expect(createDocumentDraftJob).toHaveBeenCalledOnce();
    expect(convertDocumentToMarkdown).toHaveBeenCalledOnce();
  });

  it('rejects pages mode for non-PDF files', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    writeFileSync(path.join(config.inboxPath, 'x.docx'), 'document');
    const app = createServer(config);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'x.docx', mode: 'pages' }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Non-PDF files require mode: document',
      });
    });
  });

  it('rejects invalid job payloads with stable 400 contracts', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const app = createServer(config);

    await withServer(app, async (baseUrl) => {
      const missingFile = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(missingFile.status).toBe(400);
      expect(await missingFile.json()).toEqual({
        error: 'file must be non-empty string',
      });

      const blankFile = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: '   ' }),
      });
      expect(blankFile.status).toBe(400);
      expect(await blankFile.json()).toEqual({
        error: 'file must be non-empty string',
      });

      const invalidMode = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'x.pdf', mode: 'invalid-mode' }),
      });
      expect(invalidMode.status).toBe(400);
      expect(await invalidMode.json()).toEqual({
        error: 'mode must be pages or document',
      });
    });
  });

  it('accepts valid job payloads for pdf pages and document modes', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    writeFileSync(path.join(config.inboxPath, 'ok.pdf'), 'pdf');
    writeFileSync(path.join(config.inboxPath, 'ok.docx'), 'doc');

    const pdfJob = makeJob(rootDir, {
      id: 'pdf-valid-job',
      kind: 'pdf-pages',
      sourceFilePath: path.join(config.inboxPath, 'ok.pdf'),
    });
    const documentJob = makeJob(rootDir, {
      id: 'doc-valid-job',
      kind: 'document',
      sourceFilePath: path.join(config.inboxPath, 'ok.docx'),
      pages: [
        {
          pageNumber: 1,
          nativeText: '',
          markdown: 'doc markdown',
          accepted: false,
          status: 'pending',
          engine: 'anydoc',
        },
      ],
    });

    const createDraftJobMock = vi.fn(async () => pdfJob);
    const createDocumentDraftJobMock = vi.fn(async () => documentJob);
    const app = createServer(config, {
      createDraftJob: createDraftJobMock,
      createDocumentDraftJob: createDocumentDraftJobMock,
      listJobs: vi.fn(async () => []),
    });

    await withServer(app, async (baseUrl) => {
      const pagesResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'ok.pdf', mode: 'pages' }),
      });
      expect(pagesResponse.status).toBe(201);
      expect(await pagesResponse.json()).toEqual({ job: pdfJob });

      const documentResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'ok.docx', mode: 'document' }),
      });
      expect(documentResponse.status).toBe(201);
      expect(await documentResponse.json()).toEqual({ job: documentJob });
    });

    expect(createDraftJobMock).toHaveBeenCalledOnce();
    expect(createDocumentDraftJobMock).toHaveBeenCalledOnce();
  });

  it('resumes pending jobs only when source file and kind both match', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    const sourceFilePath = path.join(config.inboxPath, 'same.pdf');
    writeFileSync(sourceFilePath, 'pdf');
    const pdfJob = makeJob(rootDir, {
      id: 'pdf-job',
      kind: 'pdf-pages',
      sourceFilePath,
      updatedAt: '2026-08-07T00:01:00.000Z',
    });
    const documentJob = makeJob(rootDir, {
      id: 'document-job',
      kind: 'document',
      sourceFilePath,
      updatedAt: '2026-08-07T00:02:00.000Z',
    });
    const createDraftJob = vi.fn(async () => pdfJob);
    const createDocumentDraftJob = vi.fn(async () => documentJob);
    const app = createServer(config, {
      listJobs: vi.fn(async () => [pdfJob, documentJob]),
      createDraftJob,
      createDocumentDraftJob,
    });

    await withServer(app, async (baseUrl) => {
      const pagesResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'same.pdf', mode: 'pages' }),
      });
      expect(pagesResponse.status).toBe(200);
      expect((await pagesResponse.json()).job.id).toBe('pdf-job');

      const documentResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'same.pdf', mode: 'document' }),
      });
      expect(documentResponse.status).toBe(200);
      expect((await documentResponse.json()).job.id).toBe('document-job');
    });
    expect(createDraftJob).not.toHaveBeenCalled();
    expect(createDocumentDraftJob).not.toHaveBeenCalled();
  });

  it('reruns document pages through anydoc conversion', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const documentPath = path.join(config.inboxPath, 'x.docx');
    mkdirSync(config.inboxPath, { recursive: true });
    writeFileSync(documentPath, 'document');
    const job = makeJob(rootDir, {
      kind: 'document',
      sourceFilePath: documentPath,
      pages: [
        {
          pageNumber: 1,
          nativeText: '',
          markdown: 'old',
          accepted: true,
          engine: 'anydoc',
        },
      ],
    });
    const convertDocumentToMarkdown = vi.fn(async () => ({
      markdown: 'new markdown',
    }));
    const saveJob = vi.fn(async () => undefined);
    const adapterRegistry = {
      getAdapter: vi.fn(),
      getDefaultAdapter: vi.fn(),
      listAdapters: vi.fn(() => []),
    };
    const app = createServer(config, {
      loadJob: vi.fn(async () => job),
      saveJob,
      convertDocumentToMarkdown,
      createAdapterRegistry: () => adapterRegistry,
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/pages/1/rerun`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect((await response.json()).page).toMatchObject({
        markdown: 'new markdown',
        engine: 'anydoc',
        accepted: false,
        status: 'pending',
      });
    });
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith(documentPath);
    expect(adapterRegistry.getAdapter).not.toHaveBeenCalled();
    expect(saveJob).toHaveBeenCalledOnce();
  });

  it('returns 404 when document pages have no preview image', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const job = makeJob(rootDir, {
      kind: 'document',
      pages: [
        {
          pageNumber: 1,
          nativeText: '',
          markdown: 'doc',
          accepted: false,
          engine: 'anydoc',
        },
      ],
    });
    const app = createServer(config, { loadJob: vi.fn(async () => job) });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/jobs/job-1/pages/1/preview`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'No preview image available for this page.',
      });
    });
  });
});
