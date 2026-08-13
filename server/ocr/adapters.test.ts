import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../core/types.js';
import { createOcrAdapterRegistry } from './adapters.js';

function makeConfig(): AppConfig {
  return {
    inboxPath: './inbox',
    jobStorePath: './.ocrtool/jobs',
    defaultEngine: 'deepseek-ocr',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      tesseract: {
        kind: 'tesseract',
        lang: 'eng',
      },
      'deepseek-ocr': {
        kind: 'deepseek-ocr',
        ollamaHost: 'http://127.0.0.1:11434',
        model: 'deepseek-ocr',
      },
      'deepseek-ocr-vlm': {
        kind: 'deepseek-ocr-vlm',
        serverHost: 'http://127.0.0.1:8080',
        model: 'mlx-community/DeepSeek-OCR-2-8bit',
      },
      'glm-ocr': {
        kind: 'glm-ocr',
        serverHost: 'http://127.0.0.1:8080',
        model: 'mlx-community/GLM-OCR-bf16',
      },
    },
  };
}

describe('createOcrAdapterRegistry', () => {
  it('returns configured default and named adapters', () => {
    const registry = createOcrAdapterRegistry(makeConfig());

    expect(registry.getDefaultAdapter().name).toBe('deepseek-ocr');
    expect(registry.getAdapter('deepseek-ocr-vlm').name).toBe(
      'deepseek-ocr-vlm',
    );
    expect(registry.getAdapter('tesseract').name).toBe('tesseract');
    expect(registry.getAdapter('glm-ocr').name).toBe('glm-ocr');
    expect(registry.listAdapters().map((adapter) => adapter.name)).toEqual([
      'tesseract',
      'deepseek-ocr',
      'deepseek-ocr-vlm',
      'glm-ocr',
    ]);
  });

  it('uses glm-ocr as the default adapter when configured', () => {
    const registry = createOcrAdapterRegistry({
      ...makeConfig(),
      defaultEngine: 'glm-ocr',
    });

    expect(registry.getDefaultAdapter().name).toBe('glm-ocr');
  });
});
