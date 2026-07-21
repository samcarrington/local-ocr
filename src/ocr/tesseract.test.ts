import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(),
  createWorker: vi.fn()
}));

vi.mock('tesseract.js', () => ({
  createWorker: mocks.createWorker
}));

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTrainedDataDir(lang = 'eng'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-tesseract-'));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, `${lang}.traineddata`), 'traineddata');
  return dir;
}

import { TesseractOcrAdapter } from './tesseract.js';

describe('TesseractOcrAdapter', () => {
  beforeEach(() => {
    mocks.recognize.mockReset();
    mocks.terminate.mockReset();
    mocks.createWorker.mockReset();

    mocks.createWorker.mockResolvedValue({
      recognize: mocks.recognize,
      terminate: mocks.terminate
    });
  });

  it('runs tesseract worker and returns normalized markdown text', async () => {
    mocks.recognize.mockResolvedValue({
      data: {
        text: '  Hello OCR  \n',
        confidence: 87
      }
    });
    mocks.terminate.mockResolvedValue(undefined);

    const adapter = new TesseractOcrAdapter({
      kind: 'tesseract',
      lang: 'eng',
      trainedDataPath: makeTrainedDataDir('eng')
    });
    const result = await adapter.processPage('/tmp/page.png');

    expect(mocks.createWorker).toHaveBeenCalledWith(
      'eng',
      1,
      expect.objectContaining({
        langPath: expect.any(String),
        gzip: false,
        cacheMethod: 'none'
      })
    );
    expect(mocks.recognize).toHaveBeenCalledWith('/tmp/page.png');
    expect(mocks.terminate).toHaveBeenCalled();
    expect(result).toEqual({
      markdown: 'Hello OCR',
      confidence: 0.87
    });
  });

  it('omits confidence when unavailable', async () => {
    mocks.recognize.mockResolvedValue({
      data: {
        text: 'plain text',
        confidence: Number.NaN
      }
    });
    mocks.terminate.mockResolvedValue(undefined);

    const adapter = new TesseractOcrAdapter({
      kind: 'tesseract',
      lang: 'eng',
      trainedDataPath: makeTrainedDataDir('eng')
    });
    const result = await adapter.processPage('/tmp/page.png', { mode: 'plain' });

    expect(result).toEqual({
      markdown: 'plain text'
    });
  });

  it('supports compressed traineddata files when present', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-tesseract-'));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, 'eng.traineddata.gz'), 'compressed-traineddata');
    mocks.recognize.mockResolvedValue({ data: { text: 'compressed text' } });
    mocks.terminate.mockResolvedValue(undefined);

    const adapter = new TesseractOcrAdapter({
      kind: 'tesseract',
      lang: 'eng',
      trainedDataPath: dir
    });

    await adapter.processPage('/tmp/page.png');

    expect(mocks.createWorker).toHaveBeenCalledWith(
      'eng',
      1,
      expect.objectContaining({
        gzip: true
      })
    );
  });

  it('fails fast when local traineddata path is not configured', async () => {
    const adapter = new TesseractOcrAdapter({ kind: 'tesseract', lang: 'eng' });

    await expect(adapter.processPage('/tmp/page.png')).rejects.toThrow(/trainedDataPath/);
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });
});
