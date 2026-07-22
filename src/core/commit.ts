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

function sanitizeCommittedMarkdown(markdown: string): string {
  const sanitized = markdown
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>(?:[^\n<]*)/gi, '')
    .replace(/<\/?script\b[^>]*>/gi, '')
    .replace(/<(?:iframe|object|embed|link|meta|style|base)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed|link|meta|style|base)\s*>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|link|meta|style|base)\b[^>]*>/gi, '');

  const allowlisted = stripDisallowedHtmlTags(sanitized);

  const attributeSanitized = allowlisted
    .replace(/(?:\s+|\/+)+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:\s+|\/+)+(?:href|xlink:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s\/>]+)/gi, (attribute) =>
      isJavaScriptUrl(getAttributeValue(attribute)) ? '' : normalizeAttributeDelimiter(attribute)
    );

  return replaceImgTags(attributeSanitized, sanitizeImageTag);
}

const RAW_HTML_TAG_ALLOWLIST = new Set([
  'a', 'b', 'strong', 'em', 'i', 'u', 'p', 'br', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'colgroup', 'col', 'figure', 'figcaption', 'img', 'span', 'div', 'details', 'summary',
  'dl', 'dt', 'dd', 'sub', 'sup', 'mark', 'kbd', 'samp', 'var', 'cite', 'q'
]);

function stripDisallowedHtmlTags(markdown: string): string {
  let result = '';
  let cursor = 0;

  for (const tag of scanHtmlTags(markdown)) {
    result += markdown.slice(cursor, tag.start);
    if (tag.name && RAW_HTML_TAG_ALLOWLIST.has(tag.name)) {
      result += markdown.slice(tag.start, tag.end);
    }
    cursor = tag.end;
  }

  return result + markdown.slice(cursor);
}

function replaceImgTags(markdown: string, replacer: (tag: string) => string): string {
  let result = '';
  let cursor = 0;

  for (const tag of scanHtmlTags(markdown)) {
    if (tag.name !== 'img') continue;
    result += markdown.slice(cursor, tag.start) + replacer(markdown.slice(tag.start, tag.end));
    cursor = tag.end;
  }

  return result + markdown.slice(cursor);
}

function scanHtmlTags(markdown: string): Array<{ start: number; end: number; name: string | null }> {
  const tags: Array<{ start: number; end: number; name: string | null }> = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const start = markdown.indexOf('<', cursor);
    if (start === -1) break;

    if (start + 1 >= markdown.length || /\s/.test(markdown[start + 1]!)) {
      cursor = start + 1;
      continue;
    }

    const name = parseHtmlTagName(markdown, start);

    let quote: '"' | "'" | undefined;
    for (let index = start + 1; index < markdown.length; index += 1) {
      const char = markdown[index];

      if (quote) {
        if (char === quote) quote = undefined;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (char === '>') {
        tags.push({ start, end: index + 1, name });
        cursor = index + 1;
        break;
      }

      if (index === markdown.length - 1) {
        cursor = start + 1;
      }
    }
  }

  return tags;
}

function parseHtmlTagName(markdown: string, start: number): string | null {
  let index = start + 1;
  if (markdown[index] === '/') index += 1;

  const match = /^[a-z][a-z0-9-]*/i.exec(markdown.slice(index));
  return match?.[0]?.toLowerCase() ?? null;
}

function getAttributeValue(attribute: string): string {
  const match = /^[\s/]*[\w:-]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attribute);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function normalizeAttributeDelimiter(attribute: string): string {
  return attribute.replace(/^[\s/]+/, ' ');
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|colon|tab|newline|sol);?/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower === 'colon') return ':';
    if (lower === 'tab') return '\t';
    if (lower === 'newline') return '\n';
    if (lower === 'sol') return '/';
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return entity;
  });
}

function normalizeUrlForSchemeCheck(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\\/g, '/')
    .replace(/[^\P{Cc}]+/gu, '')
    .trim()
    .toLowerCase();
}

function isJavaScriptUrl(value: string): boolean {
  return normalizeUrlForSchemeCheck(value).startsWith('javascript:');
}

function isRemoteImageUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalizeUrlForSchemeCheck(value));
}

function sanitizeImageTag(tag: string): string {
  return tag
    .replace(/(?:\s+|\/+)+src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attribute) =>
      isRemoteImageUrl(getAttributeValue(attribute)) ? '' : normalizeAttributeDelimiter(attribute)
    )
    .replace(/(?:\s+|\/+)+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
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

  const result = replaceImgTags(markdown, (tag) => {
    if (index >= files.length) {
      return tag;
    }

    const srcMatch = /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!srcMatch) {
      return tag;
    }

    const srcValue = srcMatch[2] ?? srcMatch[3] ?? srcMatch[4] ?? '';

    // Only rewrite unresolved local OCR placeholders. Leave already-resolved
    // refs and sanitizer-removed unsafe/external refs untouched.
    if (!isUnresolvedLocalImagePlaceholder(srcValue)) {
      return tag;
    }

    const quote = srcMatch[2] !== undefined ? '"' : srcMatch[3] !== undefined ? "'" : '';
    const replaced =
      tag.slice(0, srcMatch.index) +
      srcMatch[1] +
      quote +
      files[index] +
      quote +
      tag.slice(srcMatch.index + srcMatch[0].length);
    index += 1;
    return replaced;
  });

  return { markdown: result, count: index };
}

function isUnresolvedLocalImagePlaceholder(srcValue: string): boolean {
  return /^img_\d+\.[a-z0-9]+$/i.test(srcValue);
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
    if (getPageStatus(page) !== 'accepted') {
      continue;
    }

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
    .map((page) => {
      if (getPageStatus(page) !== 'accepted') {
        return getPageMarkdown(page).trim();
      }

      return applyFigureImages(sanitizeCommittedMarkdown(page.markdown), page.pageNumber, page.figures).trim();
    })
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
