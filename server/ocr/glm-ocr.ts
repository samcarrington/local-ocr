import type {
  GlmOcrEngineConfig,
  OcrAdapter,
  OcrResult,
} from '../core/types.js';
import { LocalMlxVlmOpenAiAdapter } from './local-mlx-vlm.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const LOCAL_HOST_ERROR_PREFIX = 'GLM-OCR requires a local mlx-vlm host';
const GLM_OCR_PROMPT = 'Text Recognition:';

export class GlmOcrAdapter
  extends LocalMlxVlmOpenAiAdapter<GlmOcrEngineConfig>
  implements OcrAdapter
{
  readonly name = 'glm-ocr';

  constructor(config: GlmOcrEngineConfig) {
    super(config, LOCAL_HOST_ERROR_PREFIX, 'GLM-OCR');
  }

  async processPage(
    imagePath: string,
    _options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    },
  ): Promise<OcrResult> {
    const markdown = cleanOcrText(
      await this.requestImageChatCompletion(imagePath, (dataUrl) => ({
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
                text: GLM_OCR_PROMPT,
              },
              {
                type: 'image_url',
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
      })),
    );

    if (!markdown) {
      throw new Error('GLM-OCR returned empty content');
    }

    return { markdown };
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
