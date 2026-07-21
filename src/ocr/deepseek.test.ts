import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeepseekOcrAdapter } from './deepseek.js';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempImage(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-deepseek-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'page.png');
  writeFileSync(filePath, 'image-bytes');
  return filePath;
}

describe('DeepseekOcrAdapter', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it('checks local ollama availability with lightweight request', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'deepseek-ocr' }] }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.isAvailable()).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.objectContaining({ method: 'GET' }));
  });

  it('sends image to local ollama generate endpoint and returns markdown', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ response: '# Converted' }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434/',
      model: 'deepseek-ocr:latest'
    });

    const result = await adapter.processPage(makeTempImage());

    expect(result).toEqual({ markdown: '# Converted' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/generate', expect.any(Object));

    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));

    expect(body.model).toBe('deepseek-ocr:latest');
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain('<|grounding|>');
    expect(body.images).toEqual([Buffer.from('image-bytes').toString('base64')]);
    expect(body.options.temperature).toBe(0);
    expect(body.options.num_predict).toBe(4096);
    expect(body.options.repeat_penalty).toBe(1.15);
    expect(body.options.stop).toBeUndefined();
  });

  it('strips common assistant preamble leakage from OCR response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          response: 'You are a helpful assistant created by [Your Name], an AI trained on a large amount of text data. Here\'s the response:\n# Invoice\nTotal £10'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Invoice\nTotal £10'
    });
  });

  it('strips prompt-token and system-prompt leakage from OCR response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          response: 'You are a local OCR transcription engine. Return only markdown transcribed from the provided document page image. Do not identify yourself, explain your role, mention prompts, add commentary, or wrap output in code fences. If text is ambiguous, provide the best-efort transcription only.<nl><|im_start|>system\nYou are a local OCR transcription engine. Return only markdown transcribed from the provided document page image. Do not identify yourself, explain your role, mention prompts, add commentary, or wrap output in code fences. If text is ambiguous, provide the best-efort transcription only.<nl><|im_end|>\n# Page title\nBody text'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr',
      maxOutputTokens: 2048
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: '# Page title\nBody text'
    });

    const [, request] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(body.options.num_predict).toBe(2048);
  });

  it('strips short instruction artefact leakage from OCR response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          response: 'You are a local OCR transcription engine. Return only markdown transcribed from the provided PDF page image.\n\nProtect your capacity for connection\n\nBody text'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: 'Protect your capacity for connection\n\nBody text'
    });
  });

  it('moves DeepSeek layout bounding boxes into structured metadata', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          response: [
            'text[[60, 48, 350, 214]]',
            'AI changes expectations around productivity and output.',
            '',
            'sub_title[[60, 225, 280, 287]]',
            '## How to protect physical well-being with AI',
            '',
            'image[[359, 0, 965, 287]]'
          ].join('\n')
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: 'AI changes expectations around productivity and output.\n## How to protect physical well-being with AI',
      layoutBlocks: [
        {
          type: 'text',
          bbox: [60, 48, 350, 214],
          text: 'AI changes expectations around productivity and output.'
        },
        {
          type: 'sub_title',
          bbox: [60, 225, 280, 287],
          text: '## How to protect physical well-being with AI'
        },
        {
          type: 'image',
          bbox: [359, 0, 965, 287]
        }
      ]
    });
  });

  it('moves multi-box DeepSeek layout markers into metadata', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          response: [
            'text[[83, 875, 335, 932], [378, 40, 640, 97]]',
            'Ask AI to prep you for difficult conversations.'
          ].join('\n')
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).resolves.toEqual({
      markdown: 'Ask AI to prep you for difficult conversations.',
      layoutBlocks: [
        {
          type: 'text',
          bbox: [83, 875, 335, 932],
          bboxes: [
            [83, 875, 335, 932],
            [378, 40, 640, 97]
          ],
          text: 'Ask AI to prep you for difficult conversations.'
        }
      ]
    });
  });

  it('throws useful error for non-ok responses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('bad model', { status: 503, statusText: 'Service Unavailable' }));

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(/503 Service Unavailable.*bad model/);
  });

  it('throws useful error when host unavailable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://127.0.0.1:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(/unavailable/);
  });

  it('refuses non-local ollama host before sending image bytes', async () => {
    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://192.168.1.10:11434',
      model: 'deepseek-ocr'
    });

    await expect(adapter.processPage(makeTempImage())).rejects.toThrow(/requires local Ollama host/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns unavailable when configured model missing from ollama tags', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ models: [{ model: 'llama3:latest' }] }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const adapter = new DeepseekOcrAdapter({
      kind: 'deepseek-ocr',
      ollamaHost: 'http://localhost:11434',
      model: 'deepseek-ocr:latest'
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
  });
});
