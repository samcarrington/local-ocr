import type {
  DeepseekOcrVlmEngineConfig,
  OcrAdapter,
  OcrResult,
} from '../core/types.js';
import { LocalMlxVlmOpenAiAdapter } from './local-mlx-vlm.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const LOCAL_HOST_ERROR_PREFIX =
  'DeepSeek OCR VLM requires a local mlx-vlm host';
const DEEPSEEK_OCR_PROMPT = '<|grounding|>Convert the document to markdown.';

export class DeepseekOcrVlmAdapter
  extends LocalMlxVlmOpenAiAdapter<DeepseekOcrVlmEngineConfig>
  implements OcrAdapter
{
  readonly name = 'deepseek-ocr-vlm';
  readonly capabilities = { outputFormats: ['markdown'] as const };

  constructor(config: DeepseekOcrVlmEngineConfig) {
    super(config, LOCAL_HOST_ERROR_PREFIX, 'DeepSeek OCR VLM');
  }

  async processPage(
    imagePath: string,
    _options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    },
  ): Promise<OcrResult> {
    const markdown = cleanOcrMarkdown(await this.requestDeepseekMarkdown(imagePath));

    if (!markdown) {
      throw new Error('DeepSeek OCR VLM returned empty content');
    }

    return { markdown };
  }

  private async requestDeepseekMarkdown(
    imagePath: string,
  ): Promise<string | null | undefined> {
    try {
      return await this.requestImageChatCompletion(imagePath, (dataUrl) =>
        this.createOpenAiPayload(dataUrl),
      );
    } catch (error) {
      if (!shouldRetryWithMlxImageFormat(error)) {
        throw error;
      }

      return await this.requestImageChatCompletion(imagePath, (dataUrl) =>
        this.createMlxPayload(dataUrl),
      );
    }
  }

  private createOpenAiPayload(dataUrl: string): unknown {
    return {
      model: this.config.model,
      temperature: 0,
      max_tokens: this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: DEEPSEEK_OCR_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };
  }

  private createMlxPayload(dataUrl: string): unknown {
    return {
      model: this.config.model,
      temperature: 0,
      max_tokens: this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: DEEPSEEK_OCR_PROMPT },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
    };
  }
}

function shouldRetryWithMlxImageFormat(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('request failed (400') ||
    message.includes('request failed (415') ||
    message.includes('request failed (422')
  );
}

function cleanOcrMarkdown(content: string | null | undefined): string {
  let markdown = content?.trim() ?? '';

  const thinkClose = markdown.lastIndexOf('</think>');
  if (thinkClose !== -1) {
    markdown = markdown.slice(thinkClose + '</think>'.length).trim();
  }

  markdown = markdown.replace(/<\|[^|]*\|>/g, '').trim();

  const fenced = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i.exec(
    markdown,
  );
  if (fenced) {
    markdown = fenced[1].trim();
  }

  return markdown.trim();
}
