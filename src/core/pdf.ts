import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Canvas, createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DEFAULT_PREVIEW_SCALE = 1.5;
// Skip decorative marks (bullets, rules, tiny icons) so extracted figures are
// only meaningful images. Measured in rendered-preview device pixels.
const MIN_IMAGE_DEVICE_PX = 32;

// Operator codes that paint a raster image. Resolved by name because the bundled
// pdf.js type defs omit some members that exist at runtime; unknown names are
// dropped rather than breaking the build.
const IMAGE_OP_CODES = new Set<number>(
  ([
    'paintImageXObject',
    'paintInlineImageXObject',
    'paintImageMaskXObject',
    'paintImageMaskXObjectGroup',
    'paintSolidColorImageMask',
    'paintInlineImageXObjectGroup',
    'paintImageXObjectRepeat',
    'paintImageMaskXObjectRepeat'
  ] as const)
    .map((name) => (OPS as unknown as Record<string, number | undefined>)[name])
    .filter((code): code is number => typeof code === 'number')
);
const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = resolveStandardFontDataUrl();

type Matrix = [number, number, number, number, number, number];

export interface PdfPageImage {
  bbox: [number, number, number, number];
  imagePath: string;
}

export interface PdfPageExtract {
  pageNumber: number;
  nativeText: string;
  previewImagePath: string;
  images: PdfPageImage[];
}

export interface ExtractPdfOptions {
  previewDir: string;
  previewScale?: number;
  extractImages?: boolean;
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

interface PdfOperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

interface PdfViewport {
  width: number;
  height: number;
  transform: number[];
}

interface PdfPageLike {
  getTextContent(): Promise<PdfTextContent>;
  getViewport(options: { scale: number }): PdfViewport;
  getOperatorList(): Promise<PdfOperatorList>;
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
        const { previewImagePath, images } = await renderPage(
          pdfPage,
          index,
          options.previewDir,
          options.previewScale,
          options.extractImages ?? true
        );

        pages.push({
          pageNumber: index,
          nativeText,
          previewImagePath,
          images
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

async function renderPage(
  page: PdfPageLike,
  pageNumber: number,
  previewDir: string,
  scale = DEFAULT_PREVIEW_SCALE,
  extractImages = true
): Promise<{ previewImagePath: string; images: PdfPageImage[] }> {
  const viewport = page.getViewport({ scale });
  const canvasFactory = nodeCanvasFactory;
  const deviceWidth = Math.max(1, Math.ceil(viewport.width));
  const deviceHeight = Math.max(1, Math.ceil(viewport.height));
  const canvas = canvasFactory.create(deviceWidth, deviceHeight);

  try {
    await page.render({
      canvasContext: canvas.context as unknown as CanvasRenderingContext2D,
      viewport,
      canvasFactory,
      background: 'white'
    }).promise;

    const previewImagePath = path.join(previewDir, `page-${String(pageNumber).padStart(4, '0')}.png`);
    await writeFile(previewImagePath, canvas.canvas.toBuffer('image/png'));

    const images = extractImages
      ? await extractPageImages(page, canvas.canvas, pageNumber, previewDir, viewport, deviceWidth, deviceHeight)
      : [];

    return { previewImagePath, images };
  } finally {
    canvasFactory.destroy(canvas);
  }
}

async function extractPageImages(
  page: PdfPageLike,
  renderedCanvas: Canvas,
  pageNumber: number,
  previewDir: string,
  viewport: PdfViewport,
  deviceWidth: number,
  deviceHeight: number
): Promise<PdfPageImage[]> {
  let regions: Array<[number, number, number, number]>;

  try {
    const opList = await page.getOperatorList();
    regions = computeImageRegions(opList, viewport.transform as Matrix, deviceWidth, deviceHeight);
  } catch (error) {
    // Image geometry is best-effort; a failure here must not break the preview
    // pipeline. Degrade to "no figures" and let text/preview continue.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[pdf] image extraction failed for page ${pageNumber}: ${reason}`);
    return [];
  }

  const images: PdfPageImage[] = [];

  for (const [regionIndex, bbox] of regions.entries()) {
    const crop = cropRegion(renderedCanvas, bbox);
    const imagePath = path.join(previewDir, `page-${String(pageNumber).padStart(4, '0')}-image-${String(regionIndex + 1).padStart(3, '0')}.png`);
    await writeFile(imagePath, crop.toBuffer('image/png'));
    images.push({ bbox, imagePath });
  }

  return images;
}

/**
 * Computes rendered-pixel bounding boxes for every image painted on the page.
 * Replays the operator list's transform stack (save/restore/transform) to
 * recover each image's CTM, then maps the unit image square through both the
 * CTM and the viewport transform into device pixels. Pure and side-effect free
 * so it can be unit-tested with a synthetic operator list.
 */
export function computeImageRegions(
  opList: PdfOperatorList,
  viewportTransform: Matrix,
  deviceWidth: number,
  deviceHeight: number
): Array<[number, number, number, number]> {
  const regions: Array<[number, number, number, number]> = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];

  for (let index = 0; index < opList.fnArray.length; index += 1) {
    const fn = opList.fnArray[index];

    if (fn === OPS.save) {
      stack.push(ctm);
      continue;
    }

    if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }

    if (fn === OPS.transform) {
      ctm = multiplyMatrix(ctm, opList.argsArray[index] as Matrix);
      continue;
    }

    if (!IMAGE_OP_CODES.has(fn)) {
      continue;
    }

    const toDevice = multiplyMatrix(viewportTransform, ctm);
    const corners: Array<[number, number]> = [
      applyMatrix(toDevice, 0, 0),
      applyMatrix(toDevice, 1, 0),
      applyMatrix(toDevice, 1, 1),
      applyMatrix(toDevice, 0, 1)
    ];
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    const x0 = clamp(Math.min(...xs), 0, deviceWidth);
    const x1 = clamp(Math.max(...xs), 0, deviceWidth);
    const y0 = clamp(Math.min(...ys), 0, deviceHeight);
    const y1 = clamp(Math.max(...ys), 0, deviceHeight);

    if (x1 - x0 >= MIN_IMAGE_DEVICE_PX && y1 - y0 >= MIN_IMAGE_DEVICE_PX) {
      regions.push([Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)]);
    }
  }

  return regions;
}

function cropRegion(sourceCanvas: Canvas, bbox: [number, number, number, number]): Canvas {
  const [x0, y0, x1, y1] = bbox;
  const width = Math.max(1, Math.round(x1 - x0));
  const height = Math.max(1, Math.round(y1 - y0));
  const out = createCanvas(width, height);
  out.getContext('2d').drawImage(sourceCanvas, Math.round(x0), Math.round(y0), width, height, 0, 0, width, height);
  return out;
}

// Affine matrices are [a, b, c, d, e, f] mapping (x, y) -> (a*x + c*y + e, b*x + d*y + f).
// multiplyMatrix(m1, m2) applies m2 first, then m1 (matches pdf.js Util.transform).
function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
