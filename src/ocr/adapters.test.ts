import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../core/types.js';
import { createOcrAdapterRegistry } from './adapters.js';

function makeConfig(): AppConfig {
  return {
    inboxPath: './inbox',
    jobStorePath: './.ocrtool/jobs',
    host: '127.0.0.1',
    port: 4312,
    defaultEngine: 'deepseek-ocr',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      tesseract: {
        kind: 'tesseract',
        lang: 'eng'
      },
      'deepseek-ocr': {
        kind: 'deepseek-ocr',
        ollamaHost: 'http://127.0.0.1:11434',
        model: 'deepseek-ocr'
      }
    }
  };
}

describe('createOcrAdapterRegistry', () => {
  it('returns configured default and named adapters', () => {
    const registry = createOcrAdapterRegistry(makeConfig());

    expect(registry.getDefaultAdapter().name).toBe('deepseek-ocr');
    expect(registry.getAdapter('tesseract').name).toBe('tesseract');
    expect(registry.listAdapters().map((adapter) => adapter.name)).toEqual(['tesseract', 'deepseek-ocr']);
  });

  it('throws for configured but unsupported adapter lookups', () => {
    const registry = createOcrAdapterRegistry({
      ...makeConfig(),
      engines: {
        tesseract: {
          kind: 'tesseract',
          lang: 'eng'
        },
        'glm-ocr': {
          kind: 'glm-ocr',
          mode: 'selfhosted'
        }
      },
      defaultEngine: 'tesseract'
    });

    expect(() => registry.getAdapter('glm-ocr')).toThrow(/not configured/);
  });
});
