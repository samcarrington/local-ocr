import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { GlmOcrEngineConfig, OcrAdapter, OcrResult } from '../core/types.js';
import { assertLocalHost, isLocalHost } from './local-host.js';

const AVAILABILITY_TIMEOUT_MS = 1_500;
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const LOCAL_HOST_ERROR_PREFIX = 'GLM-OCR requires a local mlx-vlm host';
const GLM_OCR_PROMPT = 'Text Recognition:';

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

export class GlmOcrAdapter implements OcrAdapter {
  readonly name = 'glm-ocr';

  constructor(private readonly config: GlmOcrEngineConfig) {}

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
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: GLM_OCR_PROMPT
                },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl }
                }
              ]
            }
          ]
        }),
        signal: controller.signal
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`GLM-OCR unavailable at ${this.config.serverHost}: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const details = await safeResponseText(response);
      throw new Error(
        `GLM-OCR request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ''}`
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const markdown = cleanOcrText(payload.choices?.[0]?.message?.content);

    if (!markdown) {
      throw new Error('GLM-OCR returned empty content');
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

function cleanOcrText(content: string | null | undefined): string {
  let text = content?.trim() ?? '';

  const thinkClose = text.lastIndexOf('</think>');
  if (thinkClose !== -1) {
    text = text.slice(thinkClose + '</think>'.length).trim();
  }

  text = text.replace(/<\|[^|]*\|>/g, '').trim();

  const fenced = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }

  return text.trim();
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
