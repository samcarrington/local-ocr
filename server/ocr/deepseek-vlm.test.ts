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

  it('falls back to /models when /v1/models is unavailable', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(
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
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8080/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8080/models',
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

  it('retries with mlx input_image payload when OpenAI image format is rejected', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid image format' }), {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(chatResponse('# Converted with fallback'));

    const adapter = new DeepseekOcrVlmAdapter({
      kind: 'deepseek-ocr-vlm',
      serverHost: 'http://127.0.0.1:8080',
      model: MODEL,
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Converted with fallback',
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const [, retryRequest] = vi.mocked(globalThis.fetch).mock.calls[1];
    const retryBody = JSON.parse(String(retryRequest?.body));
    expect(retryBody.messages[0].content).toEqual([
      {
        type: 'text',
        text: '<|grounding|>Convert the document to markdown.',
      },
      {
        type: 'input_image',
        image_url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
      },
    ]);
  });

  it('falls back to non-v1 endpoint when /v1/chat/completions is missing', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(chatResponse('# Converted on fallback route'));

    const adapter = new DeepseekOcrVlmAdapter({
      kind: 'deepseek-ocr-vlm',
      serverHost: 'http://127.0.0.1:8080',
      model: MODEL,
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Converted on fallback route',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.any(Object),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8080/chat/completions',
      expect.any(Object),
    );
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
