import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Canvas, createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DEFAULT_PREVIEW_SCALE = 1.5;
const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = resolveStandardFontDataUrl();

export interface PdfPageExtract {
  pageNumber: number;
  nativeText: string;
  previewImagePath: string;
}

export interface ExtractPdfOptions {
  previewDir: string;
  previewScale?: number;
}

interface CanvasFactoryInstance {
  canvas: Canvas;
  context: ReturnType<Canvas['getContext']>;
}

interface CanvasFactory {
  create(width: number, height: number): CanvasFactoryInstance;
  reset(instance: CanvasFactoryInstance, width: number, height: number): void;
  destroy(instance: CanvasFactoryInstance): void;
}

interface PdfTextItem {
  str?: string;
}

interface PdfTextContent {
  items: unknown[];
}

interface PdfPageLike {
  getTextContent(): Promise<PdfTextContent>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: unknown): { promise: Promise<void> };
  cleanup(): void;
}

const nodeCanvasFactory: CanvasFactory = {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    return { canvas, context };
  },
  reset(instance, width, height) {
    instance.canvas.width = width;
    instance.canvas.height = height;
  },
  destroy(instance) {
    instance.canvas.width = 0;
    instance.canvas.height = 0;
  }
};

export async function extractPdfPages(
  pdfPath: string,
  options: ExtractPdfOptions
): Promise<PdfPageExtract[]> {
  await mkdir(options.previewDir, { recursive: true });

  const loadingTask = getDocument({
    url: pdfPath,
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL
  } as Parameters<typeof getDocument>[0]);

  const pdf = await loadingTask.promise;

  try {
    const pages: PdfPageExtract[] = [];

    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);

      try {
        const pdfPage = page as unknown as PdfPageLike;
        const nativeText = await extractPageText(pdfPage);
        const previewImagePath = await renderPagePreview(pdfPage, index, options.previewDir, options.previewScale);

        pages.push({
          pageNumber: index,
          nativeText,
          previewImagePath
        });
      } finally {
        page.cleanup();
      }
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

function resolveStandardFontDataUrl(): string {
  const pdfjsPackagePath = require.resolve('pdfjs-dist/package.json');
  const standardFontsDir = path.join(path.dirname(pdfjsPackagePath), 'standard_fonts');

  return pathToFileURL(`${standardFontsDir}${path.sep}`).toString();
}

async function extractPageText(page: PdfPageLike) {
  const textContent = await page.getTextContent();

  return textContent.items
    .map((item) => {
      const candidate = item as PdfTextItem;
      return typeof candidate.str === 'string' ? candidate.str : '';
    })
    .join(' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderPagePreview(
  page: PdfPageLike,
  pageNumber: number,
  previewDir: string,
  scale = DEFAULT_PREVIEW_SCALE
): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvasFactory = nodeCanvasFactory;
  const canvas = canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));

  try {
    await page.render({
      canvasContext: canvas.context as unknown as CanvasRenderingContext2D,
      viewport,
      canvasFactory,
      background: 'white'
    }).promise;

    const previewImagePath = path.join(previewDir, `page-${String(pageNumber).padStart(4, '0')}.png`);
    await writeFile(previewImagePath, canvas.canvas.toBuffer('image/png'));

    return previewImagePath;
  } finally {
    canvasFactory.destroy(canvas);
  }
}
