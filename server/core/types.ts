import type {
  EngineName as SharedEngineName,
  OcrEngineCapabilities,
  OcrResult,
} from '../../shared/ocr.js';

export interface OcrAdapter {
  name: EngineName;
  capabilities?: OcrEngineCapabilities;
  isAvailable(): Promise<boolean>;
  processPage(
    imagePath: string,
    options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    },
  ): Promise<OcrResult>;
}

export interface TesseractEngineConfig {
  kind: 'tesseract';
  lang: string;
  trainedDataPath?: string;
}

export interface DeepseekOcrEngineConfig {
  kind: 'deepseek-ocr';
  ollamaHost: string;
  model: string;
  chatTimeoutMs?: number;
  maxOutputTokens?: number;
}

export interface DeepseekOcrVlmEngineConfig {
  kind: 'deepseek-ocr-vlm';
  serverHost: string;
  model: string;
  chatTimeoutMs?: number;
  maxOutputTokens?: number;
}

export interface GlmOcrEngineConfig {
  kind: 'glm-ocr';
  serverHost: string;
  model: string;
  chatTimeoutMs?: number;
  maxOutputTokens?: number;
}

export interface Nuextract3OcrEngineConfig {
  kind: 'nuextract3-ocr';
  serverHost: string;
  model: string;
  chatTimeoutMs?: number;
  maxOutputTokens?: number;
}

export type EngineConfig =
  | TesseractEngineConfig
  | DeepseekOcrEngineConfig
  | DeepseekOcrVlmEngineConfig
  | GlmOcrEngineConfig
  | Nuextract3OcrEngineConfig;

export type EngineName = SharedEngineName;

export interface AppConfig {
  inboxPath: string;
  jobStorePath: string;
  defaultEngine: EngineName;
  nativeTextMinChars: number;
  textExtractionMode: 'auto' | 'ocr';
  engines: Partial<Record<EngineName, EngineConfig>>;
}

export type {
  DraftJob,
  DraftPage,
  OcrOutputFormat,
  OcrFigure,
  OcrLayoutBlock,
  OcrResult,
  PageEngineName,
  PageQualityWarning,
} from '../../shared/ocr.js';
