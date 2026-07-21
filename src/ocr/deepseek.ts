import { readFile } from 'node:fs/promises';

import type { DeepseekOcrEngineConfig, OcrAdapter, OcrLayoutBlock, OcrResult } from '../core/types.js';

const AVAILABILITY_TIMEOUT_MS = 1_500;
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;

const GENERATE_PROMPT = [
  '<|grounding|>Convert this document page image into clean markdown.',
  'Preserve headings, paragraphs, lists, and tables where clear.',
  'Return only text visible in the image.'
].join(' ');

type OllamaGenerateResponse = {
  response?: string;
};

type OllamaTagsResponse = {
  models?: Array<Record<string, unknown>>;
};

export class DeepseekOcrAdapter implements OcrAdapter {
  readonly name = 'deepseek-ocr';

  constructor(private readonly config: DeepseekOcrEngineConfig) {}

  async isAvailable(): Promise<boolean> {
    if (!isLocalOllamaHost(this.config.ollamaHost)) {
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

    try {
      const response = await fetch(this.resolveUrl('/api/tags'), {
        method: 'GET',
        signal: controller.signal
      });

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as OllamaTagsResponse;
      return listAvailableModelNames(payload).includes(normalizeModelName(this.config.model));
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
    assertLocalOllamaHost(this.config.ollamaHost);

    const imageBase64 = await readFile(imagePath, { encoding: 'base64' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS);

    let response: Response;

    try {
      response = await fetch(this.resolveUrl('/api/generate'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: GENERATE_PROMPT,
          images: [imageBase64],
          stream: false,
          options: {
            temperature: 0,
            num_predict: this.config.maxOutputTokens ?? 4096,
            repeat_penalty: 1.15
          }
        }),
        signal: controller.signal
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`DeepSeek OCR unavailable at ${this.config.ollamaHost}: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const details = await safeResponseText(response);
      throw new Error(
        `DeepSeek OCR request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ''}`
      );
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    const parsed = parseGroundedOcrMarkdown(payload.response);
    const markdown = cleanOcrMarkdown(parsed.markdown);

    if (!markdown) {
      throw new Error('DeepSeek OCR returned empty content');
    }

    return {
      markdown,
      layoutBlocks: parsed.layoutBlocks.length ? parsed.layoutBlocks : undefined
    };
  }

  private resolveUrl(pathname: string): string {
    return new URL(pathname, withTrailingSlash(this.config.ollamaHost)).toString();
  }
}

function parseGroundedOcrMarkdown(content: string | undefined): { markdown: string; layoutBlocks: OcrLayoutBlock[] } {
  const source = content ?? '';
  const lines = source.replace(/\r/g, '').split('\n');
  const markdownLines: string[] = [];
  const layoutBlocks: OcrLayoutBlock[] = [];
  let currentBlock: OcrLayoutBlock | null = null;
  let currentText: string[] = [];

  const flushBlock = () => {
    if (!currentBlock) return;
    const text = currentText.join('\n').trim();
    if (text) {
      currentBlock.text = text;
      markdownLines.push(text);
    }
    layoutBlocks.push(currentBlock);
    currentBlock = null;
    currentText = [];
  };

  for (const line of lines) {
    const marker = parseLayoutMarker(line);
    if (marker) {
      flushBlock();
      currentBlock = marker;
      continue;
    }

    if (currentBlock) {
      currentText.push(line);
    } else {
      markdownLines.push(line);
    }
  }

  flushBlock();

  return {
    markdown: markdownLines.join('\n'),
    layoutBlocks
  };
}

function parseLayoutMarker(line: string): OcrLayoutBlock | null {
  const match = /^([a-zA-Z_][\w-]*)\s*\[\[([\s\S]+)\]\]\s*$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const bboxes = parseBboxes(match[2]);

  if (bboxes.length === 0) {
    return null;
  }

  return {
    type: match[1],
    bbox: bboxes[0],
    bboxes: bboxes.length > 1 ? bboxes : undefined
  };
}

function parseBboxes(value: string): Array<[number, number, number, number]> {
  const parts = (value.match(/-?\d+/g) ?? []).map(Number);
  if (parts.length < 4 || parts.length % 4 !== 0 || parts.some((part) => !Number.isFinite(part))) {
    return [];
  }

  const bboxes: Array<[number, number, number, number]> = [];
  for (let index = 0; index < parts.length; index += 4) {
    bboxes.push([parts[index], parts[index + 1], parts[index + 2], parts[index + 3]]);
  }

  return bboxes;
}

function cleanOcrMarkdown(content: string | undefined): string {
  let markdown = content?.trim() ?? '';

  markdown = markdown.replace(/<\|im_start\|>\s*system[\s\S]*?<\|im_end\|>/gi, '');
  markdown = markdown.replace(/<\|im_(?:start|end)\|>/gi, '');
  markdown = markdown.replace(/<nl>/gi, '\n');

  const systemPromptPattern = /you are a local ocr transcription engine\.[\s\S]*?(?:best-effort|best-efort) transcription only\.?/gi;
  markdown = markdown.replace(systemPromptPattern, '');

  markdown = markdown.replace(
    /^you are a local ocr transcription engine\.\s*return only markdown transcribed from the provided (?:document|pdf) page image\.\s*/i,
    ''
  );

  markdown = markdown.replace(/^convert this document page image into clean markdown\s*/i, '');

  markdown = markdown.replace(
    /^you are a helpful assistant[^\n]*?(?:here(?:'|’)?s the response:|here is the response:)\s*/i,
    ''
  );

  markdown = markdown.replace(
    /^(?:sure|certainly|of course)[,.!]?\s*(?:here(?:'|’)?s|here is)\s+(?:the\s+)?(?:transcription|markdown|response)[:\s-]*/i,
    ''
  );

  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(markdown);
  if (fenced) {
    markdown = fenced[1].trim();
  }

  return markdown.trim();
}

function assertLocalOllamaHost(ollamaHost: string): void {
  if (!isLocalOllamaHost(ollamaHost)) {
    throw new Error(
      `DeepSeek OCR requires local Ollama host (localhost, 127.0.0.1, or ::1). Received: ${ollamaHost}`
    );
  }
}

function isLocalOllamaHost(ollamaHost: string): boolean {
  try {
    const hostname = new URL(ollamaHost).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function listAvailableModelNames(payload: OllamaTagsResponse): string[] {
  return (payload.models ?? [])
    .flatMap((model) => [model.name, model.model])
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
