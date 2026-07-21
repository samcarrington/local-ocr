import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Nuextract3OcrAdapter } from './nuextract3.js';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempImage(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-nuextract3-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'page.png');
  writeFileSync(filePath, 'image-bytes');
  return filePath;
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Nuextract3OcrAdapter', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it('checks local mlx-vlm availability against /v1/models', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'numind/NuExtract3-mlx-nvfp4' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.isAvailable()).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/models',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns unavailable when configured model missing from /v1/models', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'some/other-model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://localhost:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it('does not probe when host is not local', async () => {
    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://192.168.1.10:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends the page image to the chat completions endpoint and returns markdown', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(chatResponse('# Converted'));

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080/',
      model: 'numind/NuExtract3-mlx-nvfp4',
      maxOutputTokens: 2048
    });

    const result = await adapter.processPage(makeTempImage());

    expect(result).toEqual({ markdown: '# Converted' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.any(Object)
    );

    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));

    expect(body.model).toBe('numind/NuExtract3-mlx-nvfp4');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(2048);
    expect(body.enable_thinking).toBe(false);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}` }
      }
    ]);
    // No text instruction: it would be rendered into the document region and pollute transcription.
    expect(
      body.messages[0].content.some((item: { type: string }) => item.type === 'text')
    ).toBe(false);
    expect(body.chat_template_kwargs).toEqual({ mode: 'markdown', enable_thinking: false });
  });

  it('strips a leaked reasoning block from the response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      chatResponse('<think>The document is an invoice.</think>\n# Invoice\nTotal £10')
    );

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Invoice\nTotal £10'
    });
  });

  it('strips leaked ChatML control tokens but preserves HTML markup', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      chatResponse('# 01\n\n<table><tr><td>x<sup>1</sup></td></tr></table>\n\n01<|im_end|>')
    );

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# 01\n\n<table><tr><td>x<sup>1</sup></td></tr></table>\n\n01'
    });
  });

  it('unwraps a fenced markdown code block', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      chatResponse('```markdown\n# Title\n\n<table><tr><td>x</td></tr></table>\n```')
    );

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Title\n\n<table><tr><td>x</td></tr></table>'
    });
  });

  it('throws a useful error for non-ok responses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('model not loaded', { status: 503, statusText: 'Service Unavailable' })
    );

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(
      /503 Service Unavailable.*model not loaded/
    );
  });

  it('throws a useful error when the server is unavailable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(/unavailable/);
  });

  it('throws on empty content', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(chatResponse('   '));

    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(/empty content/);
  });

  it('refuses non-local server host before sending image bytes', async () => {
    const adapter = new Nuextract3OcrAdapter({
      kind: 'nuextract3-ocr',
      serverHost: 'http://192.168.1.10:8080',
      model: 'numind/NuExtract3-mlx-nvfp4'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(/requires a local mlx-vlm host/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
