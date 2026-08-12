import type {
  Nuextract3OcrEngineConfig,
  OcrAdapter,
  OcrResult,
} from '../core/types.js';
import { LocalMlxVlmOpenAiAdapter } from './local-mlx-vlm.js';

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
const CHAT_TEMPLATE_KWARGS = {
  mode: 'markdown',
  enable_thinking: false,
} as const;

export class Nuextract3OcrAdapter
  extends LocalMlxVlmOpenAiAdapter<Nuextract3OcrEngineConfig>
  implements OcrAdapter
{
  readonly name = 'nuextract3-ocr';

  constructor(config: Nuextract3OcrEngineConfig) {
    super(config, LOCAL_HOST_ERROR_PREFIX, 'NuExtract3 OCR');
  }

  async processPage(
    imagePath: string,
    _options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    },
  ): Promise<OcrResult> {
    const markdown = cleanOcrMarkdown(
      await this.requestImageChatCompletion(imagePath, (dataUrl) => ({
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
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
        chat_template_kwargs: CHAT_TEMPLATE_KWARGS,
      })),
    );

    if (!markdown) {
      throw new Error('NuExtract3 OCR returned empty content');
    }

    return { markdown };
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
