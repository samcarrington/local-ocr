import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeepseekOcrVlmAdapter } from './deepseek-vlm.js';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];
const MODEL = 'mlx-community/DeepSeek-OCR-2-8bit';

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempImage(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-deepseek-vlm-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'page.png');
  writeFileSync(filePath, 'image-bytes');
  return filePath;
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DeepseekOcrVlmAdapter', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it('checks local mlx-vlm availability against /v1/models', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: MODEL }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new DeepseekOcrVlmAdapter({
      kind: 'deepseek-ocr-vlm',
      serverHost: 'http://127.0.0.1:8080',
      model: MODEL,
    });

    await expect(adapter.isAvailable()).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the grounded Markdown prompt and page image to mlx-vlm', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(chatResponse('# Converted'));

    const adapter = new DeepseekOcrVlmAdapter({
      kind: 'deepseek-ocr-vlm',
      serverHost: 'http://127.0.0.1:8080/',
      model: MODEL,
      maxOutputTokens: 2048,
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Converted',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.any(Object),
    );
    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: MODEL,
      temperature: 0,
      max_tokens: 2048,
      stream: false,
    });
    expect(body.messages[0].content).toEqual([
      {
        type: 'text',
        text: '<|grounding|>Convert the document to markdown.',
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
        },
      },
    ]);
  });

  it('strips reasoning, control tokens, and surrounding code fences', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      chatResponse('<think>x</think>\n```markdown\n# Hello<|im_end|>\n```'),
    );

    const adapter = new DeepseekOcrVlmAdapter({
      kind: 'deepseek-ocr-vlm',
      serverHost: 'http://127.0.0.1:8080',
      model: MODEL,
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Hello',
    });
  });

  it('refuses a non-local host before sending image bytes', async () => {
    const adapter = new DeepseekOcrVlmAdapter({
      kind: 'deepseek-ocr-vlm',
      serverHost: 'http://192.168.1.10:8080',
      model: MODEL,
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(
      /requires a local mlx-vlm host/,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
