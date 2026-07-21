#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const lang = process.argv[2] || 'eng';
const outputDir = process.argv[3] || './tessdata';
const outputPath = path.join(outputDir, `${lang}.traineddata`);
const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${encodeURIComponent(lang)}.traineddata`;

console.log(`Downloading ${url}`);
const response = await fetch(url);

if (!response.ok) {
  throw new Error(`Failed to download ${lang}.traineddata (${response.status} ${response.statusText})`);
}

const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < 1024) {
  throw new Error(`Downloaded ${lang}.traineddata is unexpectedly small (${bytes.byteLength} bytes)`);
}

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, bytes);
console.log(`Saved ${outputPath} (${bytes.byteLength} bytes)`);
