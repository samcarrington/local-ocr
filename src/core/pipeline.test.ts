import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument, createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractPdfPages } from './pdf.js';
import type { AppConfig, OcrAdapter } from './types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('./pdf.js');
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
    host: '127.0.0.1',
    port: 4312,
    defaultEngine: 'tesseract',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      tesseract: {
        kind: 'tesseract',
        lang: 'eng'
      }
    }
  };
}

function createInboxPdf(rootDir: string, name = 'report.pdf', contents: string | Buffer = 'mock-pdf'): string {
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

describe('createDraftJob', () => {
  it('uses native text when above threshold and OCR only for short pages', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: vi.fn(async () => true),
      processPage: vi.fn(async (imagePath: string) => ({
        markdown: `OCR:${path.basename(imagePath)}`,
        confidence: 0.88
      }))
    };

    const registry = {
      getDefaultAdapter: () => mockAdapter,
      getAdapter: () => mockAdapter,
      listAdapters: () => [mockAdapter]
    };

    const extractPdfPages = vi.fn(async () => [
      {
        pageNumber: 1,
        nativeText: 'This page already has enough native text to skip OCR.',
        previewImagePath: path.join(rootDir, 'previews', 'page-0001.png')
      },
      {
        pageNumber: 2,
        nativeText: 'short',
        previewImagePath: path.join(rootDir, 'previews', 'page-0002.png')
      }
    ]);

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({ extractPdfPages }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(pdfPath, makeConfig(rootDir), registry, {
      now: new Date('2026-07-13T12:00:00.000Z')
    });

    expect(extractPdfPages).toHaveBeenCalledOnce();
    expect(mockAdapter.processPage).toHaveBeenCalledTimes(1);
    expect(mockAdapter.processPage).toHaveBeenCalledWith(
      path.join(rootDir, 'previews', 'page-0002.png'),
      { mode: 'markdown' }
    );
    expect(job.pages).toEqual([
      {
        pageNumber: 1,
        imagePath: path.join(rootDir, 'previews', 'page-0001.png'),
        nativeText: 'This page already has enough native text to skip OCR.',
        markdown: 'This page already has enough native text to skip OCR.',
        accepted: false,
        status: 'pending',
        engine: 'native'
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
        layoutBlocks: undefined
      }
    ]);

    const stored = JSON.parse(await readFile(path.join(makeConfig(rootDir).jobStorePath, `${encodeURIComponent(job.id)}.json`), 'utf8'));
    expect(stored.pages[0].engine).toBe('native');
  });

  it('can skip persistence when caller wants draft only', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => ({ markdown: 'ocr body' })
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          nativeText: '',
          previewImagePath: path.join(rootDir, 'previews', 'page-0001.png')
        }
      ]
    }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(
      pdfPath,
      makeConfig(rootDir),
      {
        getDefaultAdapter: () => mockAdapter,
        getAdapter: () => mockAdapter,
        listAdapters: () => [mockAdapter]
      },
      { persist: false }
    );

    await expect(access(path.join(makeConfig(rootDir).jobStorePath, `${encodeURIComponent(job.id)}.json`))).rejects.toThrow();
  });

  it('keeps draft creation alive when OCR fails for one page', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir);

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => {
        throw new Error('missing traineddata');
      }
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          nativeText: '',
          previewImagePath: path.join(rootDir, 'previews', 'page-0001.png')
        }
      ]
    }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(
      pdfPath,
      makeConfig(rootDir),
      {
        getDefaultAdapter: () => mockAdapter,
        getAdapter: () => mockAdapter,
        listAdapters: () => [mockAdapter]
      },
      { persist: false }
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
          message: 'Initial OCR failed for page 1: missing traineddata'
        }
      ]
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
      processPage: async () => ({ markdown: 'forced image OCR' })
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => [
        {
          pageNumber: 1,
          nativeText: 'This native text would normally skip OCR because it is long enough.',
          previewImagePath: path.join(rootDir, 'previews', 'page-0001.png')
        }
      ]
    }));
    const { createDraftJob } = await import('./pipeline.js');

    const job = await createDraftJob(
      pdfPath,
      config,
      {
        getDefaultAdapter: () => mockAdapter,
        getAdapter: () => mockAdapter,
        listAdapters: () => [mockAdapter]
      },
      { persist: false }
    );

    expect(job.pages[0]).toMatchObject({
      nativeText: 'This native text would normally skip OCR because it is long enough.',
      markdown: 'forced image OCR',
      engine: 'tesseract'
    });
  });

  it('extracts native text and non-blank preview from real pdf', async () => {
    const rootDir = makeTempDir();
    const pdfPath = createInboxPdf(rootDir, 'tiny.pdf', createTinyPdfBuffer('Tiny PDF native text'));
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
    const pixels = analysisContext.getImageData(0, 0, rendered.width, rendered.height).data;
    const hasNonWhitePixel = Array.from({ length: pixels.length / 4 }, (_, index) => {
      const offset = index * 4;
      return pixels[offset] !== 255 || pixels[offset + 1] !== 255 || pixels[offset + 2] !== 255;
    }).some(Boolean);

    expect(hasNonWhitePixel).toBe(true);
  });

  it('rejects pdf paths outside inbox', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const outsidePdfPath = path.join(rootDir, 'outside.pdf');
    writeFileSync(outsidePdfPath, 'mock-pdf');

    const mockAdapter: OcrAdapter = {
      name: 'tesseract',
      isAvailable: async () => true,
      processPage: async () => ({ markdown: 'ocr body' })
    };

    vi.resetModules();
    vi.doMock('./pdf.js', () => ({
      extractPdfPages: async () => []
    }));
    const { createDraftJob } = await import('./pipeline.js');

    await expect(
      createDraftJob(
        outsidePdfPath,
        config,
        {
          getDefaultAdapter: () => mockAdapter,
          getAdapter: () => mockAdapter,
          listAdapters: () => [mockAdapter]
        },
        { persist: false }
      )
    ).rejects.toThrow(/inboxPath/);
  });
});
