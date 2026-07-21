import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { commitJob } from './commit.js';
import type { AppConfig, DraftJob } from './types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-commit-'));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(rootDir: string): AppConfig {
  return {
    inboxPath: path.join(rootDir, 'inbox'),
    jobStorePath: path.join(rootDir, '.ocrtool', 'jobs'),
    host: '127.0.0.1',
    port: 4312,
    defaultEngine: 'tesseract',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      tesseract: {
        kind: 'tesseract',
        lang: 'eng'
      },
      'deepseek-ocr': {
        kind: 'deepseek-ocr',
        ollamaHost: 'http://127.0.0.1:11434',
        model: 'deepseek-ocr'
      }
    }
  };
}

function createPdf(rootDir: string, name = 'sample.pdf'): string {
  mkdirSync(path.join(rootDir, 'inbox'), { recursive: true });
  const pdfPath = path.join(rootDir, 'inbox', name);
  writeFileSync(pdfPath, 'pdf');
  return pdfPath;
}

describe('commitJob', () => {
  it('writes stable markdown and keeps pdf in place for partial commits', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'report.pdf');
    const figureSourcePath = path.join(rootDir, 'figure-source.png');
    writeFileSync(figureSourcePath, 'figure');
    const job: DraftJob = {
      id: 'job-1',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 2,
          imagePath: 'page-2.png',
          nativeText: '',
          markdown: 'Second page accepted.',
          accepted: true,
          status: 'accepted',
          engine: 'deepseek-ocr'
        },
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: 'First page accepted.',
          accepted: true,
          status: 'accepted',
          engine: 'deepseek-ocr',
          figures: [
            {
              bbox: [0, 0, 10, 10],
              imagePath: figureSourcePath
            }
          ]
        },
        {
          pageNumber: 3,
          imagePath: 'page-3.png',
          nativeText: '',
          markdown: 'Ignored pending page body.',
          accepted: false,
          status: 'pending',
          engine: 'tesseract'
        },
        {
          pageNumber: 4,
          imagePath: 'page-4.png',
          nativeText: '',
          markdown: 'Ignored failed page body.',
          accepted: false,
          status: 'failed',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job, {
      convertedAt: new Date('2026-07-13T12:34:56.000Z')
    });

    const copiedFigurePath = path.join(path.dirname(result.markdownPath), 'images', 'page-001-figure-001.png');

    expect(result.movedSourcePdf).toBe(false);
    expect(result.processedPdfPath).toBeNull();
    expect(existsSync(sourcePdfPath)).toBe(true);
    expect(existsSync(path.join(path.dirname(result.markdownPath), 'images'))).toBe(true);
    expect(existsSync(copiedFigurePath)).toBe(true);
    expect(await readFile(copiedFigurePath, 'utf8')).toBe('figure');
    expect(await readFile(result.markdownPath, 'utf8')).toBe(`---
source_pdf: "report.pdf"
ocr_engine: "mixed"
converted_at: "2026-07-13T12:34:56.000Z"
---

First page accepted.

![](images/page-001-figure-001.png)

Second page accepted.

[[OCR PENDING: page 3]]

[[OCR FAILED: page 4]]
`);
  });

  it('moves source pdf to processed when every page accepted', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'done.pdf');
    const job: DraftJob = {
      id: 'job-2',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: 'All done.',
          accepted: true,
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job, {
      convertedAt: new Date('2026-07-13T01:02:03.000Z')
    });

    expect(result.movedSourcePdf).toBe(true);
    expect(result.processedPdfPath).toBe(path.join(config.inboxPath, 'processed', 'done.pdf'));
    expect(existsSync(sourcePdfPath)).toBe(false);
    expect(existsSync(result.processedPdfPath!)).toBe(true);
    expect(await readFile(result.markdownPath, 'utf8')).toContain('All done.');
    expect(readdirSync(path.dirname(result.markdownPath)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('does not duplicate existing markdown figure links', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'linked.pdf');
    const figureSourcePath = path.join(rootDir, 'linked-figure.png');
    writeFileSync(figureSourcePath, 'linked-figure');
    const job: DraftJob = {
      id: 'job-5',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: 'Has figure already.\n\n![](images/page-001-figure-001.png)',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract',
          figures: [
            {
              bbox: [0, 0, 10, 10],
              imagePath: figureSourcePath
            }
          ]
        }
      ]
    };

    const result = await commitJob(config, job);

    expect(await readFile(result.markdownPath, 'utf8')).toContain('Has figure already.\n\n![](images/page-001-figure-001.png)');
    expect((await readFile(result.markdownPath, 'utf8')).match(/!\[\]\(images\/page-001-figure-001\.png\)/g)).toHaveLength(1);
  });

  it('marks all-native documents as native provenance', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'native.pdf');
    const job: DraftJob = {
      id: 'job-4',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: 'Native only',
          markdown: 'Native only',
          accepted: false,
          status: 'pending',
          engine: 'native'
        }
      ]
    };

    const result = await commitJob(config, job, {
      convertedAt: new Date('2026-07-13T10:11:12.000Z')
    });

    expect(result.movedSourcePdf).toBe(false);
    expect(await readFile(result.markdownPath, 'utf8')).toContain('ocr_engine: "native"');
  });

  it('uses accepted flag deterministically when accepted contradicts status', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'contradiction.pdf');
    const job: DraftJob = {
      id: 'job-3',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: 'Accepted wins.',
          accepted: true,
          status: 'failed',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);

    expect(result.movedSourcePdf).toBe(true);
    expect(await readFile(result.markdownPath, 'utf8')).toContain('Accepted wins.');
  });
});
