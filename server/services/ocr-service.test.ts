import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../core/types.js';
import type { DraftJob } from '../../shared/ocr.js';
import { createOcrService } from './ocr-service.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function testConfig(): Promise<AppConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'local-ocr-service-'));
  directories.push(root);
  return {
    inboxPath: path.join(root, 'inbox'),
    jobStorePath: path.join(root, 'jobs'),
    defaultEngine: 'tesseract',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: { tesseract: { kind: 'tesseract', lang: 'eng' } },
  };
}

function job(imagePath: string): DraftJob {
  return {
    id: 'test/job',
    kind: 'pdf-pages',
    sourceFilePath: '/inbox/input.pdf',
    status: 'pending_review',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    pages: [{
      pageNumber: 1,
      imagePath,
      markdown: '',
      accepted: false,
      status: 'pending',
      engine: 'tesseract',
      nativeText: '',
    }],
  };
}

describe('OCR service', () => {
  it('rejects collapsed DeepSeek OCR without overwriting the pending page', async () => {
    const config = await testConfig();
    const draft = job('/tmp/page.png');
    draft.pages[0].nativeText = Array.from(
      { length: 80 },
      (_, index) => `nativeword${index}`,
    ).join(' ');
    draft.pages[0].markdown = 'Existing review text';
    const saveJob = vi.fn();
    const adapter = {
      name: 'deepseek-ocr-vlm' as const,
      isAvailable: vi.fn(),
      processPage: vi.fn(async () => ({
        markdown: draft.pages[0].nativeText.replaceAll(' ', ''),
      })),
    };
    const service = createOcrService(config, {
      loadJob: vi.fn(async () => draft),
      saveJob,
      createAdapterRegistry: () => ({
        getAdapter: () => adapter,
      }) as never,
    });

    await expect(service.rerun('test/job', '1', {
      engine: 'deepseek-ocr-vlm',
    })).rejects.toMatchObject({
      statusCode: 502,
      message: 'DeepSeek OCR returned text without word boundaries; the page was not changed.',
    });
    expect(draft.pages[0].markdown).toBe('Existing review text');
    expect(saveJob).not.toHaveBeenCalled();
  });

  it('lists only PDF filenames in stable order', async () => {
    const config = await testConfig();
    await mkdir(config.inboxPath);
    await Promise.all([
      writeFile(path.join(config.inboxPath, 'z.pdf'), ''),
      writeFile(path.join(config.inboxPath, 'a.PDF'), ''),
      writeFile(path.join(config.inboxPath, 'notes.txt'), ''),
    ]);

    await expect(createOcrService(config).listPdfs()).resolves.toEqual([
      'a.PDF',
      'z.pdf',
    ]);
  });

  it('rejects a preview symlink that escapes the job preview directory', async () => {
    const config = await testConfig();
    const previews = path.join(config.jobStorePath, 'test%2Fjob', 'previews');
    await mkdir(previews, { recursive: true });
    const outside = path.join(path.dirname(config.jobStorePath), 'outside.png');
    await writeFile(outside, 'not-a-preview');
    const preview = path.join(previews, 'page-1.png');
    await symlink(outside, preview);

    const service = createOcrService(config, {
      loadJob: vi.fn(async () => job(preview)),
    });

    await expect(service.getPreview('test/job', '1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Preview not found for page 1',
    });
  });
});
