import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppConfig, DraftJob, DraftPage, OcrFigure, PageEngineName } from './types.js';

export interface CommitJobResult {
  outputDir: string;
  markdownPath: string;
  processedPdfPath: string | null;
  movedSourcePdf: boolean;
}

function getPageStatus(page: DraftPage): 'accepted' | 'pending' | 'failed' {
  if (page.accepted) {
    return 'accepted';
  }

  return page.status === 'failed' ? 'failed' : 'pending';
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempFilePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  await writeFile(tempFilePath, contents, 'utf8');
  await rename(tempFilePath, filePath);
}

function getOcrProvenance(job: DraftJob): PageEngineName | 'mixed' {
  const engines = new Set(job.pages.map((page) => page.engine));

  if (engines.size === 0 || (engines.size === 1 && engines.has('native'))) {
    return 'native';
  }

  if (engines.size === 1) {
    return job.pages[0]!.engine;
  }

  return 'mixed';
}

function getPageMarkdown(page: DraftPage): string {
  const status = getPageStatus(page);

  if (status === 'accepted') {
    return page.markdown;
  }

  if (status === 'failed') {
    return `[[OCR FAILED: page ${page.pageNumber}]]`;
  }

  return `[[OCR PENDING: page ${page.pageNumber}]]`;
}

function getFigureFileName(pageNumber: number, figureIndex: number, imagePath: string): string {
  const extension = path.extname(imagePath) || '.png';
  return `page-${String(pageNumber).padStart(3, '0')}-figure-${String(figureIndex).padStart(3, '0')}${extension}`;
}

function getFigureFileNames(pageNumber: number, figures: OcrFigure[]): string[] {
  return figures.map((figure, index) => `images/${getFigureFileName(pageNumber, index + 1, figure.imagePath)}`);
}

/**
 * Wires committed figure files into a page's markdown. Engines like
 * nuextract3-ocr embed inline `<figure><img src="img_1.png">` placeholders that
 * point at files it never produced; those get rewritten in document order to
 * the saved crops. Engines with no inline image refs fall back to appending
 * `![](images/...)` links (deepseek-ocr / grounded output).
 */
function applyFigureImages(markdown: string, pageNumber: number, figures: OcrFigure[] | undefined): string {
  if (!figures || figures.length === 0) {
    return markdown;
  }

  const files = getFigureFileNames(pageNumber, figures);
  const rewritten = rewriteInlineImageSrcs(markdown, files);

  if (rewritten.count > 0) {
    return rewritten.markdown;
  }

  return appendFigureLinks(markdown, files);
}

function rewriteInlineImageSrcs(markdown: string, files: string[]): { markdown: string; count: number } {
  let index = 0;

  const result = markdown.replace(/<img\b[^>]*>/gi, (tag) => {
    if (index >= files.length) {
      return tag;
    }

    const srcMatch = /(\ssrc\s*=\s*")([^"]*)(")/i.exec(tag);
    if (!srcMatch) {
      return tag;
    }

    // Leave already-resolved or external references untouched.
    if (/^(images\/|https?:|\/|data:|#)/i.test(srcMatch[2])) {
      return tag;
    }

    const replaced =
      tag.slice(0, srcMatch.index) +
      srcMatch[1] +
      files[index] +
      srcMatch[3] +
      tag.slice(srcMatch.index + srcMatch[0].length);
    index += 1;
    return replaced;
  });

  return { markdown: result, count: index };
}

function appendFigureLinks(markdown: string, files: string[]): string {
  const missingLinks = files.map((file) => `![](${file})`).filter((link) => !markdown.includes(link));

  if (missingLinks.length === 0) {
    return markdown;
  }

  return `${markdown.trimEnd()}\n\n${missingLinks.join('\n')}`;
}

async function copyPageFigures(outputDir: string, pages: DraftPage[]): Promise<void> {
  const imagesDir = path.join(outputDir, 'images');
  await mkdir(imagesDir, { recursive: true });

  for (const page of pages) {
    for (const [index, figure] of (page.figures ?? []).entries()) {
      const targetPath = path.join(imagesDir, getFigureFileName(page.pageNumber, index + 1, figure.imagePath));
      await copyFile(figure.imagePath, targetPath);
    }
  }
}

function renderMarkdown(job: DraftJob, convertedAt: string): string {
  const sourcePdf = path.basename(job.sourcePdfPath);
  const ocrEngine = getOcrProvenance(job);
  const body = job.pages
    .slice()
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => applyFigureImages(getPageMarkdown(page), page.pageNumber, page.figures).trim())
    .join('\n\n');

  return [
    '---',
    `source_pdf: ${JSON.stringify(sourcePdf)}`,
    `ocr_engine: ${JSON.stringify(ocrEngine)}`,
    `converted_at: ${JSON.stringify(convertedAt)}`,
    '---',
    '',
    body,
    ''
  ].join('\n');
}

export async function commitJob(
  config: AppConfig,
  job: DraftJob,
  options?: { convertedAt?: Date }
): Promise<CommitJobResult> {
  const sourceFileName = path.basename(job.sourcePdfPath);
  const baseName = path.basename(sourceFileName, path.extname(sourceFileName));
  const outputDir = path.join(config.inboxPath, baseName);
  const markdownPath = path.join(outputDir, `${baseName}.md`);
  const processedPdfPath = path.join(config.inboxPath, 'processed', sourceFileName);
  const convertedAt = (options?.convertedAt ?? new Date()).toISOString();

  await mkdir(outputDir, { recursive: true });
  await copyPageFigures(outputDir, job.pages);
  await writeFileAtomic(markdownPath, renderMarkdown(job, convertedAt));

  const allAccepted = job.pages.every((page) => getPageStatus(page) === 'accepted');

  if (!allAccepted) {
    return {
      outputDir,
      markdownPath,
      processedPdfPath: null,
      movedSourcePdf: false
    };
  }

  await mkdir(path.dirname(processedPdfPath), { recursive: true });
  await rename(job.sourcePdfPath, processedPdfPath);

  return {
    outputDir,
    markdownPath,
    processedPdfPath,
    movedSourcePdf: true
  };
}
