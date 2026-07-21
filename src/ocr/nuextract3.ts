import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Nuextract3OcrEngineConfig, OcrAdapter, OcrResult } from '../core/types.js';
import { assertLocalHost, isLocalHost } from './local-host.js';

const AVAILABILITY_TIMEOUT_MS = 1_500;
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const LOCAL_HOST_ERROR_PREFIX = 'NuExtract3 OCR requires a local mlx-vlm host';

// NuExtract3's markdown ("document-to-Markdown") mode is driven entirely by the
// model's chat template: with no `template` provided, `mode` defaults to
// `content`, which is the Markdown-conversion task. mlx-vlm's server only
// forwards `enable_thinking` (not arbitrary `mode`/`chat_template_kwargs`) to
// apply_chat_template, so we rely on that default and just disable thinking for
// deterministic output. We deliberately send NO text instruction — the template
// renders any text into the document region, which would pollute the
// transcription. `chat_template_kwargs` is included for OpenAI-compatible
// servers that DO honour it (e.g. vLLM); mlx-vlm ignores it harmlessly.
const CHAT_TEMPLATE_KWARGS = { mode: 'markdown', enable_thinking: false } as const;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type ModelsResponse = {
  data?: Array<{ id?: unknown }>;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export class Nuextract3OcrAdapter implements OcrAdapter {
  readonly name = 'nuextract3-ocr';

  constructor(private readonly config: Nuextract3OcrEngineConfig) {}

  async isAvailable(): Promise<boolean> {
    if (!isLocalHost(this.config.serverHost)) {
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

    try {
      const response = await fetch(this.resolveUrl('/v1/models'), {
        method: 'GET',
        signal: controller.signal
      });

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as ModelsResponse;
      return listModelIds(payload).includes(normalizeModelName(this.config.model));
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async processPage(
    imagePath: string,
    _options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    }
  ): Promise<OcrResult> {
    assertLocalHost(this.config.serverHost, LOCAL_HOST_ERROR_PREFIX);

    const dataUrl = await this.readImageAsDataUrl(imagePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS);

    let response: Response;

    try {
      response = await fetch(this.resolveUrl('/v1/chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          enable_thinking: false,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: dataUrl }
                }
              ]
            }
          ],
          chat_template_kwargs: CHAT_TEMPLATE_KWARGS
        }),
        signal: controller.signal
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`NuExtract3 OCR unavailable at ${this.config.serverHost}: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const details = await safeResponseText(response);
      throw new Error(
        `NuExtract3 OCR request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ''}`
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const markdown = cleanOcrMarkdown(payload.choices?.[0]?.message?.content);

    if (!markdown) {
      throw new Error('NuExtract3 OCR returned empty content');
    }

    return { markdown };
  }

  private async readImageAsDataUrl(imagePath: string): Promise<string> {
    const base64 = await readFile(imagePath, { encoding: 'base64' });
    const mime = MIME_BY_EXTENSION[path.extname(imagePath).toLowerCase()] ?? 'image/png';
    return `data:${mime};base64,${base64}`;
  }

  private resolveUrl(pathname: string): string {
    return new URL(pathname, withTrailingSlash(this.config.serverHost)).toString();
  }
}

/**
 * Cleans the raw model output:
 * - strips a leading reasoning block (should be absent with enable_thinking:false,
 *   kept as a guard);
 * - removes ChatML control tokens (e.g. `<|im_end|>`, `<|im_start|>`), which
 *   mlx-vlm leaks into the content; these are pipe-delimited (`<|...|>`) so they
 *   never collide with legitimate HTML like `<table>`/`<figure>`/`<sup>`;
 * - unwraps a surrounding markdown code fence.
 * NuExtract3 markdown legitimately contains `<table>`, `<figure>`, and LaTeX, so
 * those are preserved.
 */
function cleanOcrMarkdown(content: string | null | undefined): string {
  let markdown = content?.trim() ?? '';

  const thinkClose = markdown.lastIndexOf('</think>');
  if (thinkClose !== -1) {
    markdown = markdown.slice(thinkClose + '</think>'.length).trim();
  }

  markdown = markdown.replace(/<\|[^|]*\|>/g, '').trim();

  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(markdown);
  if (fenced) {
    markdown = fenced[1].trim();
  }

  return markdown.trim();
}

function listModelIds(payload: ModelsResponse): string[] {
  return (payload.data ?? [])
    .map((model) => model.id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(normalizeModelName);
}

function normalizeModelName(name: string): string {
  return name.trim().toLowerCase();
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
