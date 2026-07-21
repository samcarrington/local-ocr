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

  it('rewrites inline placeholder image srcs to committed crop files in order', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'figures.pdf');
    const cropOne = path.join(rootDir, 'crop-1.png');
    const cropTwo = path.join(rootDir, 'crop-2.png');
    writeFileSync(cropOne, 'crop-one');
    writeFileSync(cropTwo, 'crop-two');
    const job: DraftJob = {
      id: 'job-fig',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown:
            '# Report\n\n<figure data-type="image" data-id="img_1"><img src="img_1.png" alt="A logo"/></figure>\n\nBody\n\n<figure data-type="image" data-id="img_2"><img src="img_2.png" alt="A chart"/></figure>',
          accepted: true,
          status: 'accepted',
          engine: 'nuextract3-ocr',
          figures: [
            { bbox: [0, 0, 10, 10], imagePath: cropOne },
            { bbox: [0, 0, 10, 10], imagePath: cropTwo }
          ]
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');
    const imagesDir = path.join(path.dirname(result.markdownPath), 'images');

    expect(markdown).toContain('<img src="images/page-001-figure-001.png" alt="A logo"/>');
    expect(markdown).toContain('<img src="images/page-001-figure-002.png" alt="A chart"/>');
    expect(markdown).not.toContain('img_1.png');
    expect(markdown).not.toContain('img_2.png');
    // No duplicate appended links when rewriting inline refs.
    expect(markdown).not.toContain('![](images/');
    expect(existsSync(path.join(imagesDir, 'page-001-figure-001.png'))).toBe(true);
    expect(await readFile(path.join(imagesDir, 'page-001-figure-001.png'), 'utf8')).toBe('crop-one');
    expect(await readFile(path.join(imagesDir, 'page-001-figure-002.png'), 'utf8')).toBe('crop-two');
  });

  it('leaves surplus inline image placeholders untouched when fewer crops exist', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'mismatch.pdf');
    const cropOne = path.join(rootDir, 'only-crop.png');
    writeFileSync(cropOne, 'only');
    const job: DraftJob = {
      id: 'job-mismatch',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: '<img src="img_1.png" alt="one"/>\n<img src="img_2.png" alt="two"/>',
          accepted: true,
          status: 'accepted',
          engine: 'nuextract3-ocr',
          figures: [{ bbox: [0, 0, 10, 10], imagePath: cropOne }]
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<img src="images/page-001-figure-001.png" alt="one"/>');
    expect(markdown).toContain('<img src="img_2.png" alt="two"/>');
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
