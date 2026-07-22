import { getEngineConfig } from '../core/config.js';
import type { AppConfig, EngineName, OcrAdapter } from '../core/types.js';
import { DeepseekOcrAdapter } from './deepseek.js';
import { GlmOcrAdapter } from './glm-ocr.js';
import { Nuextract3OcrAdapter } from './nuextract3.js';
import { TesseractOcrAdapter } from './tesseract.js';

export interface OcrAdapterRegistry {
  getDefaultAdapter(): OcrAdapter;
  getAdapter(name: EngineName): OcrAdapter;
  listAdapters(): OcrAdapter[];
}

export function createOcrAdapterRegistry(config: AppConfig): OcrAdapterRegistry {
  const adapters = new Map<EngineName, OcrAdapter>();

  const tesseractConfig = getEngineConfig(config, 'tesseract');
  if (tesseractConfig) {
    adapters.set('tesseract', new TesseractOcrAdapter(tesseractConfig));
  }

  const deepseekConfig = getEngineConfig(config, 'deepseek-ocr');
  if (deepseekConfig) {
    adapters.set('deepseek-ocr', new DeepseekOcrAdapter(deepseekConfig));
  }

  const nuextract3Config = getEngineConfig(config, 'nuextract3-ocr');
  if (nuextract3Config) {
    adapters.set('nuextract3-ocr', new Nuextract3OcrAdapter(nuextract3Config));
  }

  const glmConfig = getEngineConfig(config, 'glm-ocr');
  if (glmConfig) {
    adapters.set('glm-ocr', new GlmOcrAdapter(glmConfig));
  }

  return {
    getDefaultAdapter() {
      return getRequiredAdapter(adapters, config.defaultEngine);
    },
    getAdapter(name: EngineName) {
      return getRequiredAdapter(adapters, name);
    },
    listAdapters() {
      return [...adapters.values()];
    }
  };
}

function getRequiredAdapter(adapters: Map<EngineName, OcrAdapter>, name: EngineName): OcrAdapter {
  const adapter = adapters.get(name);

  if (!adapter) {
    throw new Error(`OCR adapter not configured for engine: ${name}`);
  }

  return adapter;
}
