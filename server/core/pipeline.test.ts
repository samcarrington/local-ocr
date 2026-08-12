import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { createCanvas, loadImage, PDFDocument } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractPdfPages } from './pdf.js';
import type { AppConfig, OcrAdapter } from './types.js';
import { DocumentConversionError } from '../convert/anydoc.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('./pdf.js');
  vi.doUnmock('../convert/anydoc.js');
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-pipeline-'));
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

function createInboxPdf(
  rootDir: string,
  name = 'report.pdf',
  contents: string | Buffer = 'mock-pdf',
): string {
  const inboxPath = makeConfig(rootDir).inboxPath;
  mkdirSync(inboxPath, { recursive: true });
  const pdfPath = path.join(inboxPath, name);
  writeFileSync(pdfPath, contents);
  return pdfPath;
}

function createTinyPdfBuffer(text: string): Buffer {
  const document = new PDFDocument();
  const context = document.beginPage(240, 120);

  context.fillStyle = 'white';
  context.fillRect(0, 0, 240, 120);
  context.fillStyle = 'black';
  context.font = '24px sans-serif';
  context.fillText(text, 24, 64);
  document.endPage();

  return document.close();
}

async function createPdfWithImageBuffer(): Promise<Buffer> {
  const imageCanvas = createCanvas(160, 100);
  const imageContext = imageCanvas.getContext('2d');
  imageContext.fillStyle = 'red';
  imageContext.fillRect(0, 0, 160, 100);
  const embedded = await loadImage(imageCanvas.toBuffer('image/png'));

  const document = new PDFDocument();
  const context = document.beginPage(360, 240) as unknown as SKRSContext2D;
  context.fillStyle = 'white';
  context.fillRect(0, 0, 360, 240);
  context.drawImage(embedded, 60, 50, 160, 100);
  document.endPage();

  return document.close();
}

describe('createDraftJob', () => {
  it('uses native text when above threshold and OCR only for short pages', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: vi.fn(async () => true),
      processPage: vi.fn(async (imagePath: string) => ({
        markdown: `OCR:${path.basename(imagePath)}`,
        confidence: 0.88,
      })),
    };

    const registry = {
      getDefaultAdapter: () => mockAdapter,
      getAdapter: () => mockAdapter,
      listAdapters: () => [mockAdapter],
    };

    const extractPdfPages = vi.fn(async () => [
      {
        pageNumber: 1,
        nativeText: 'This page already has enough native text to skip OCR.',
        previewImagePath: path.join(rootDir, 'previews', 'page-0001.png'),
      },
      {
        pageNumber: 2,
        nativeText: 'short',
        previewImagePath: path.join(rootDir, 'previews', 'page-0002.png'),
      },
    ]);

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({ extractPdfPages }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(pdfPath, makeConfig(rootDir), registry, {
      now: new Date('2026-07-13T12:00:00.000Z'),
    });

    expect(extractPdfPages).toHaveBeenCalledOnce();
    expect(mockAdapter.processPage).toHaveBeenCalledTimes(1);
    expect(mockAdapter.processPage).toHaveBeenCalledWith(
      path.join(rootDir, 'previews', 'page-0002.png'),
      { mode: 'markdown' },
    );
    expect(job.pages).toEqual([
      {
        pageNumber: 1,
        imagePath: path.join(rootDir, 'previews', 'page-0001.png'),
        nativeText: 'This page already has enough native text to skip OCR.',
        markdown: 'This page already has enough native text to skip OCR.',
        accepted: false,
        status: 'pending',
        engine: 'native',
      },
      {
        pageNumber: 2,
        imagePath: path.join(rootDir, 'previews', 'page-0002.png'),
        nativeText: 'short',
        markdown: 'OCR:page-0002.png',
        accepted: false,
        status: 'pending',
        engine: 'tesseract',
        confidence: 0.88,
        figures: undefined,
        layoutBlocks: undefined,
      },
    ]);

    const stored = JSON.parse(
      await readFile(
        path.join(
          makeConfig(rootDir).jobStorePath,
          `${encodeURIComponent(job.id)}.json`,
        ),
        'utf8',
      ),
    );
    expect(stored.pages[0].engine).toBe('native');
  });

  it('can skip persistence when caller wants draft only', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => ({ markdown: 'ocr body' }),
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          nativeText: '',
          previewImagePath: path.join(rootDir, 'previews', 'page-0001.png'),
        },
      ],
    }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(
      pdfPath,
      makeConfig(rootDir),
      {
        getDefaultAdapter: () => mockAdapter,
        getAdapter: () => mockAdapter,
        listAdapters: () => [mockAdapter],
      },
      { persist: false },
    );

    await expect(
      access(
        path.join(
          makeConfig(rootDir).jobStorePath,
          `${encodeURIComponent(job.id)}.json`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('keeps draft creation alive when OCR fails for one page', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => {
        throw new Error('missing traineddata');
      },
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          nativeText: '',
          previewImagePath: path.join(rootDir, 'previews', 'page-0001.png'),
        },
      ],
    }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(
      pdfPath,
      makeConfig(rootDir),
      {
        getDefaultAdapter: () => mockAdapter,
        getAdapter: () => mockAdapter,
        listAdapters: () => [mockAdapter],
      },
      { persist: false },
    );

    expect(job.pages[0]).toMatchObject({
      pageNumber: 1,
      status: 'failed',
      accepted: false,
      engine: 'tesseract',
      markdown: '[[OCR FAILED: page 1 - missing traineddata]]',
      qualityWarnings: [
        {
          type: 'ocr-failed',
          severity: 'warning',
          message: 'Initial OCR failed for page 1: missing traineddata',
        },
      ],
    });
  });

  it('can force OCR on pages with native text', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);
    const config = makeConfig(rootDir);
    config.textExtractionMode = 'ocr';

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => ({ markdown: 'forced image OCR' }),
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          nativeText:
            'This native text would normally skip OCR because it is long enough.',
          previewImagePath: path.join(rootDir, 'previews', 'page-0001.png'),
        },
      ],
    }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(
      pdfPath,
      config,
      {
        getDefaultAdapter: () => mockAdapter,
        getAdapter: () => mockAdapter,
        listAdapters: () => [mockAdapter],
      },
      { persist: false },
    );

    expect(job.pages[0]).toMatchObject({
      nativeText:
        'This native text would normally skip OCR because it is long enough.',
      markdown: 'forced image OCR',
      engine: 'tesseract',
    });
  });

  it('extracts native text and non-blank preview from real pdf', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(
      rootDir,
      'tiny.pdf',
      createTinyPdfBuffer('Tiny PDF native text'),
    );
    const previewDir = path.join(rootDir, 'previews');

    const pages = await extractPdfPages(pdfPath, { previewDir });

    expect(pages).toHaveLength(1);
    expect(pages[0]?.nativeText).toContain('Tiny PDF native text');
    await access(pages[0]!.previewImagePath);

    const previewBuffer = await readFile(pages[0]!.previewImagePath);
    expect(previewBuffer.byteLength).toBeGreaterThan(0);

    const rendered = await loadImage(previewBuffer);
    const analysisCanvas = createCanvas(rendered.width, rendered.height);
    const analysisContext = analysisCanvas.getContext('2d');
    analysisContext.drawImage(rendered, 0, 0);
    const pixels = analysisContext.getImageData(
      0,
      0,
      rendered.width,
      rendered.height,
    ).data;
    const hasNonWhitePixel = Array.from(
      { length: pixels.length / 4 },
      (_, index) => {
        const offset = index * 4;
        return (
          pixels[offset] !== 255 ||
          pixels[offset + 1] !== 255 ||
          pixels[offset + 2] !== 255
        );
      },
    ).some(Boolean);

    expect(hasNonWhitePixel).toBe(true);
  });

  it('extracts embedded page images as cropped figure files', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(
      rootDir,
      'with-image.pdf',
      await createPdfWithImageBuffer(),
    );
    const previewDir = path.join(rootDir, 'previews');

    const pages = await extractPdfPages(pdfPath, { previewDir });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.images.length).toBeGreaterThanOrEqual(1);

    const figure = pages[0]!.images[0]!;
    await access(figure.imagePath);
    const cropBuffer = await readFile(figure.imagePath);
    expect(cropBuffer.byteLength).toBeGreaterThan(0);

    const [x0, y0, x1, y1] = figure.bbox;
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
  });

  it('skips image extraction when disabled', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(
      rootDir,
      'no-extract.pdf',
      await createPdfWithImageBuffer(),
    );
    const previewDir = path.join(rootDir, 'previews');

    const pages = await extractPdfPages(pdfPath, {
      previewDir,
      extractImages: false,
    });

    expect(pages[0]!.images).toEqual([]);
  });

  it('rejects pdf paths outside inbox', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const outsidePdfPath = path.join(rootDir, 'outside.pdf');
    writeFileSync(outsidePdfPath, 'mock-pdf');

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => ({ markdown: 'ocr body' }),
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [],
    }));
    const { createDraftJob } = await import('./pipeline.js');

    await expect(
      createDraftJob(
        outsidePdfPath,
        config,
        {
          getDefaultAdapter: () => mockAdapter,
          getAdapter: () => mockAdapter,
          listAdapters: () => [mockAdapter],
        },
        { persist: false },
      ),
    ).rejects.toThrow(/inboxPath/);
  });
});

describe('createDocumentDraftJob', () => {
  it('creates a one-page document draft from converted Markdown', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    const documentPath = path.join(config.inboxPath, 'report.docx');
    writeFileSync(documentPath, 'mock-document');
    const convertDocumentToMarkdown = vi.fn(async () => ({
      markdown: '# Converted report',
    }));

    vi.resetModules();
    vi.doMock('../convert/anydoc.js', () => ({
      convertDocumentToMarkdown,
    }));
    const { createDocumentDraftJob } = await import('./pipeline.js');

    const job = await createDocumentDraftJob(documentPath, config);

    expect(convertDocumentToMarkdown).toHaveBeenCalledWith(documentPath);
    expect(job).toMatchObject({
      kind: 'document',
      sourceFilePath: documentPath,
      status: 'pending_review',
      pages: [
        {
          pageNumber: 1,
          nativeText: '',
          markdown: '# Converted report',
          accepted: false,
          status: 'pending',
          engine: 'anydoc',
        },
      ],
    });
    expect(job.pages).toHaveLength(1);
    expect(job.pages[0]).not.toHaveProperty('imagePath');
    expect(job.createdAt).toBe(job.updatedAt);
    expect(job.id).toEqual(expect.any(String));
  });

  it('rejects document paths outside inbox', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const outsideDocumentPath = path.join(rootDir, 'outside.docx');

    vi.resetModules();
    vi.doMock('../convert/anydoc.js', () => ({
      convertDocumentToMarkdown: vi.fn(),
    }));
    const { createDocumentDraftJob } = await import('./pipeline.js');

    await expect(
      createDocumentDraftJob(outsideDocumentPath, config),
    ).rejects.toThrow(/inboxPath/);
  });

  it('propagates DocumentConversionError unchanged', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    mkdirSync(config.inboxPath, { recursive: true });
    const documentPath = path.join(config.inboxPath, 'encrypted.docx');
    writeFileSync(documentPath, 'mock-document');
    const conversionError = new DocumentConversionError(
      422,
      'This document is password-protected or encrypted and cannot be converted.',
    );

    vi.resetModules();
    vi.doMock('../convert/anydoc.js', () => ({
      convertDocumentToMarkdown: vi.fn(async () => {
        throw conversionError;
      }),
    }));
    const { createDocumentDraftJob } = await import('./pipeline.js');

    await expect(
      createDocumentDraftJob(documentPath, config),
    ).rejects.toBe(conversionError);
  });
});
