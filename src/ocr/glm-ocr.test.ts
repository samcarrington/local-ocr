import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlmOcrAdapter } from './glm-ocr.js';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempImage(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-glm-'));
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

describe('GlmOcrAdapter', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it('checks local mlx-vlm availability against /v1/models', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'mlx-community/GLM-OCR-bf16' }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.isAvailable()).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns unavailable when configured model missing from /v1/models', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'some/other-model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://localhost:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it('does not probe when host is not local', async () => {
    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://192.168.1.10:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends prompt and page image to chat completions endpoint and returns text', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      chatResponse('Recognized text'),
    );

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://127.0.0.1:8080/',
      model: 'mlx-community/GLM-OCR-bf16',
      maxOutputTokens: 2048,
    });

    const result = await adapter.processPage(makeTempImage());

    expect(result).toEqual({ markdown: 'Recognized text' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.any(Object),
    );

    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));

    expect(body.model).toBe('mlx-community/GLM-OCR-bf16');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(2048);
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Text Recognition:' },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
        },
      },
    ]);
  });

  it('strips reasoning, ChatML tokens, and surrounding code fences', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      chatResponse('<think>x</think>\n```text\nHello<|im_end|>\n```'),
    );

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: 'Hello',
    });
  });

  it('throws a useful error for non-ok responses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('model not loaded', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    );

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(
      /503 Service Unavailable.*model not loaded/,
    );
  });

  it('throws a useful error when the server is unavailable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error('connect ECONNREFUSED'),
    );

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(
      /unavailable/,
    );
  });

  it('throws on empty content', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(chatResponse('   '));

    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(
      /empty content/,
    );
  });

  it('refuses non-local server host before sending image bytes', async () => {
    const adapter = new GlmOcrAdapter({
      kind: 'glm-ocr',
      serverHost: 'http://192.168.1.10:8080',
      model: 'mlx-community/GLM-OCR-bf16',
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(
      /requires a local mlx-vlm host/,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
