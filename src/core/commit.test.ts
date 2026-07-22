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

  it('sanitizes executable raw html while preserving markdown and safe html', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'unsafe.pdf');
    const job: DraftJob = {
      id: 'job-unsafe',
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
            '# Title\n\n<div class="note" onclick="alert(1)">Safe **markdown** HTML</div>\n<script>bad()</script>\n<iframe src="x"></iframe>\n<style>.bad{}</style>\n<a href="javascript:bad()">bad link</a>\n<img src="https://example.test/x.png" alt="remote">\n<img src="data:image/png;base64,abc" alt="data">\n<img src="images/local.png" alt="local">',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('# Title');
    expect(markdown).toContain('<div class="note">Safe **markdown** HTML</div>');
    expect(markdown).toContain('<a>bad link</a>');
    expect(markdown).toContain('<img alt="remote">');
    expect(markdown).toContain('<img alt="data">');
    expect(markdown).toContain('<img src="images/local.png" alt="local">');
    expect(markdown).not.toMatch(/<script|bad\(\)|<iframe|<style|onclick=|javascript:|https:\/\/example\.test|data:image/i);
  });

  it('strips obfuscated executable html and unsafe raw image urls', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'obfuscated-unsafe.pdf');
    const job: DraftJob = {
      id: 'job-obfuscated-unsafe',
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
            '<script src="bad.js"/>\n<script>alert(1)\n<a href="java&#x09;script&#58;bad()">encoded</a>\n<a href=" javascript:spaced()">spaced link</a>\n<img src=" https://example.test/spaced.png" alt="spaced remote">\n<img src="//example.test/a.png" srcset="//example.test/a.png 1x, images/local.png 2x" alt="proto">\n<img srcset="https://example.test/a.png 1x, data:image/png;base64,abc 2x" alt="remote srcset">\n<img srcset="images/one.png 1x, images/two.png 2x" alt="local srcset">',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<a>encoded</a>');
    expect(markdown).toContain('<a>spaced link</a>');
    expect(markdown).toContain('<img alt="spaced remote">');
    expect(markdown).toContain('<img srcset="images/local.png 2x" alt="proto">');
    expect(markdown).toContain('<img alt="remote srcset">');
    expect(markdown).toContain('<img srcset="images/one.png 1x, images/two.png 2x" alt="local srcset">');
    expect(markdown).not.toMatch(/<script|alert\(1\)|javascript:|java&#x09;script|spaced\.png|\/\/example\.test|https:\/\/example\.test|data:image/i);
  });

  it('strips unsafe svg xlink href urls', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'svg-xlink.pdf');
    const job: DraftJob = {
      id: 'job-svg-xlink',
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
            '<svg><a xlink:href="javascript:bad()">unsafe</a></svg>\n' +
            '<svg><a xlink:href="java&#x09;script&#58;encoded()">encoded</a></svg>\n' +
            '<svg><a xlink:href="#safe">safe</a></svg>\n' +
            '<a href="/normal">normal</a>',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<a>unsafe</a>');
    expect(markdown).toContain('<a>encoded</a>');
    expect(markdown).toContain('<a xlink:href="#safe">safe</a>');
    expect(markdown).toContain('<a href="/normal">normal</a>');
    expect(markdown).not.toMatch(/<svg|<\/svg|javascript:|java&#x09;script|xlink:href="javascript/i);
  });

  it('strips malformed and disallowed raw html tags before attribute sanitization', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'malformed-tags.pdf');
    const job: DraftJob = {
      id: 'job-malformed-tags',
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
            '<scr/onerror=""ipt>alert(1)</scr/onerror=""ipt>\n' +
            '<math><mi>x</mi></math>\n' +
            '<custom-tag data-x="1">custom</custom-tag>\n' +
            '<span data-x="1">safe span</span>',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('alert(1)');
    expect(markdown).toContain('x');
    expect(markdown).toContain('custom');
    expect(markdown).toContain('<span data-x="1">safe span</span>');
    expect(markdown).not.toMatch(/<scr|<\/scr|onerror|<math|<\/math|<mi|<\/mi|<custom-tag|<\/custom-tag/i);
  });

  it('preserves normal table figure and local image markup through raw html allowlist', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'ordinary-html.pdf');
    const job: DraftJob = {
      id: 'job-ordinary-html',
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
            '<table><caption>Data</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>\n' +
            '<figure><img src="images/chart.png" alt="Chart"><figcaption><strong>Chart</strong></figcaption></figure>',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<table><caption>Data</caption><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>');
    expect(markdown).toContain('<figure><img src="images/chart.png" alt="Chart"><figcaption><strong>Chart</strong></figcaption></figure>');
  });

  it('sanitizes img tags with greater-than characters inside quoted attributes', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'quoted-greater-than.pdf');
    const job: DraftJob = {
      id: 'job-quoted-greater-than',
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
            '<img alt=">" src="https://example.test/escaped.png">\n' +
            "<img alt='>' src=\"https://example.test/single.png\">\n" +
            '<img alt=">" src="images/local.png">\n' +
            "<img alt='>' src=\"images/single-local.png\">",
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<img alt=">">');
    expect(markdown).toContain("<img alt='>'>");
    expect(markdown).toContain('<img alt=">" src="images/local.png">');
    expect(markdown).toContain("<img alt='>' src=\"images/single-local.png\">");
    expect(markdown).not.toMatch(/https:\/\/example\.test/i);
  });

  it('strips slash-prefixed event attributes while preserving self-closing image tags', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'slash-event-attribute.pdf');
    const job: DraftJob = {
      id: 'job-slash-event-attribute',
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
            '<img/onerror="alert(1)" src="images/local.png" alt="slash event">\n' +
            '<img src="images/self-closing.png" alt="self closing" />',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<img src="images/local.png" alt="slash event">');
    expect(markdown).toContain('<img src="images/self-closing.png" alt="self closing" />');
    expect(markdown).not.toMatch(/onerror|alert\(1\)/i);
  });

  it('treats slash as an unsafe URL attribute delimiter while preserving self-closing tags', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'slash-url-attribute.pdf');
    const job: DraftJob = {
      id: 'job-slash-url-attribute',
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
            '<a/href="javascript:bad()">bad link</a>\n' +
            '<svg><a/xlink:href="javascript:bad()">bad xlink</a></svg>\n' +
            '<img/src="https://example.test/remote.png" alt="slash src">\n' +
            '<img/srcset="https://example.test/remote.png 1x, images/local.png 2x" alt="slash srcset">\n' +
            '<img/src="images/self-closing.png" alt="self closing" />',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<a>bad link</a>');
    expect(markdown).toContain('<a>bad xlink</a>');
    expect(markdown).toContain('<img alt="slash src">');
    expect(markdown).toContain('<img srcset="images/local.png 2x" alt="slash srcset">');
    expect(markdown).toContain('<img src="images/self-closing.png" alt="self closing" />');
    expect(markdown).not.toMatch(/<svg|<\/svg|href=|xlink:href=|javascript:|https:\/\/example\.test/i);
  });

  it('strips unquoted remote raw image urls while preserving unquoted local paths', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'unquoted-image-urls.pdf');
    const job: DraftJob = {
      id: 'job-unquoted-image-urls',
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
            '<img src=//example.test/x alt=proto>\n' +
            '<img src=http://example.test/x alt=http>\n' +
            '<img src=https://example.test/x alt=https>\n' +
            '<img src=data:image/png;base64,abc alt=data>\n' +
            '<img src=images/local.png srcset=//example.test/x,images/local.png alt=local>',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<img alt=proto>');
    expect(markdown).toContain('<img alt=http>');
    expect(markdown).toContain('<img alt=https>');
    expect(markdown).toContain('<img alt=data>');
    expect(markdown).toContain('<img src=images/local.png srcset=images/local.png alt=local>');
    expect(markdown).not.toMatch(/src=\/\/example\.test|src=https?:\/\/example\.test|src=data:|srcset=\/\/example\.test/i);
  });

  it('strips entity-encoded C0 and C1 controls before unsafe URL checks', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'encoded-controls.pdf');
    const job: DraftJob = {
      id: 'job-encoded-controls',
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
            '<a href="&#14;javascript:bad()">c0 link</a>\n<img src="&#14;https://example.test/c0.png" alt="c0 src">\n<img src="&#x85;https://example.test/c1.png" alt="c1 src">\n<img srcset="&#14;https://example.test/c0.png 1x, images/local.png 2x" alt="c0 srcset">',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<a>c0 link</a>');
    expect(markdown).toContain('<img alt="c0 src">');
    expect(markdown).toContain('<img alt="c1 src">');
    expect(markdown).toContain('<img srcset="images/local.png 2x" alt="c0 srcset">');
    expect(markdown).not.toMatch(/href=|&#14;|&#x85;|javascript:|https:\/\/example\.test/i);
  });

  it('strips entity-encoded protocol-relative raw image urls while preserving local values', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'encoded-protocol-relative.pdf');
    const job: DraftJob = {
      id: 'job-encoded-protocol-relative',
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
            '<img src="&sol;&sol;example.test/x.png" alt="encoded proto">\n<img src="images/local.png" srcset="images/one.png 1x, images/two.png 2x" alt="local">',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<img alt="encoded proto">');
    expect(markdown).toContain('<img src="images/local.png" srcset="images/one.png 1x, images/two.png 2x" alt="local">');
    expect(markdown).not.toMatch(/&sol;&sol;example\.test|\/\/example\.test/i);
  });

  it('strips backslash-normalized protocol-relative raw image urls while preserving local paths', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'backslash-protocol-relative.pdf');
    const job: DraftJob = {
      id: 'job-backslash-protocol-relative',
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
            '<img src="\\\\example.test/x.png" alt="backslash proto">\n' +
            '<img src="images\\local.png" srcset="images\\one.png 1x, images/two.png 2x" alt="local">',
          accepted: true,
          status: 'accepted',
          engine: 'tesseract'
        }
      ]
    };

    const result = await commitJob(config, job);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('<img alt="backslash proto">');
    expect(markdown).toContain('<img src="images\\local.png" srcset="images\\one.png 1x, images/two.png 2x" alt="local">');
    expect(markdown).not.toMatch(/\\\\example\.test|\/\/example\.test/i);
  });

  it('does not copy or wire figures from pending and failed pages during partial commits', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'partial-figures.pdf');
    const acceptedCrop = path.join(rootDir, 'accepted.png');
    const pendingCrop = path.join(rootDir, 'pending.png');
    const failedCrop = path.join(rootDir, 'failed.png');
    writeFileSync(acceptedCrop, 'accepted');
    writeFileSync(pendingCrop, 'pending');
    writeFileSync(failedCrop, 'failed');
    const job: DraftJob = {
      id: 'job-partial-figures',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: 'Accepted page.',
          accepted: true,
          status: 'accepted',
          engine: 'deepseek-ocr',
          figures: [{ bbox: [0, 0, 10, 10], imagePath: acceptedCrop }]
        },
        {
          pageNumber: 2,
          imagePath: 'page-2.png',
          nativeText: '',
          markdown: '<img src="pending.png" alt="pending">',
          accepted: false,
          status: 'pending',
          engine: 'deepseek-ocr',
          figures: [{ bbox: [0, 0, 10, 10], imagePath: pendingCrop }]
        },
        {
          pageNumber: 3,
          imagePath: 'page-3.png',
          nativeText: '',
          markdown: '<img src="failed.png" alt="failed">',
          accepted: false,
          status: 'failed',
          engine: 'deepseek-ocr',
          figures: [{ bbox: [0, 0, 10, 10], imagePath: failedCrop }]
        }
      ]
    };

    const result = await commitJob(config, job);
    const outputDir = path.dirname(result.markdownPath);
    const markdown = await readFile(result.markdownPath, 'utf8');

    expect(markdown).toContain('![](images/page-001-figure-001.png)');
    expect(markdown).toContain('[[OCR PENDING: page 2]]');
    expect(markdown).toContain('[[OCR FAILED: page 3]]');
    expect(markdown).not.toContain('page-002-figure');
    expect(markdown).not.toContain('page-003-figure');
    expect(existsSync(path.join(outputDir, 'images', 'page-001-figure-001.png'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'images', 'page-002-figure-001.png'))).toBe(false);
    expect(existsSync(path.join(outputDir, 'images', 'page-003-figure-001.png'))).toBe(false);
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

  it('rewrites single-quoted and unquoted placeholder image srcs without appending duplicate fallback links', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const sourcePdfPath = createPdf(rootDir, 'figure-quotes.pdf');
    const cropOne = path.join(rootDir, 'quote-crop-1.png');
    const cropTwo = path.join(rootDir, 'quote-crop-2.png');
    writeFileSync(cropOne, 'quote-one');
    writeFileSync(cropTwo, 'quote-two');
    const job: DraftJob = {
      id: 'job-figure-quotes',
      sourcePdfPath,
      status: 'pending_review',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      pages: [
        {
          pageNumber: 1,
          imagePath: 'page-1.png',
          nativeText: '',
          markdown: "<figure><img alt='one' src='img_1.png' data-id='a'></figure>\n<figure><img alt=two src=img_2.png data-id=b></figure>",
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

    expect(markdown).toContain("<img alt='one' src='images/page-001-figure-001.png' data-id='a'>");
    expect(markdown).toContain('<img alt=two src=images/page-001-figure-002.png data-id=b>');
    expect(markdown).not.toContain('img_1.png');
    expect(markdown).not.toContain('img_2.png');
    expect(markdown).not.toContain('![](images/');
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
