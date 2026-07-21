export interface OcrFigure {
  bbox: [number, number, number, number];
  imagePath: string;
}

export interface OcrLayoutBlock {
  type: string;
  bbox: [number, number, number, number];
  bboxes?: Array<[number, number, number, number]>;
  text?: string;
}

export interface PageQualityWarning {
  type: 'low-native-coverage' | 'ocr-failed';
  severity: 'warning';
  message: string;
  coverage: number;
  missingSnippets: string[];
}

export interface OcrResult {
  markdown: string;
  confidence?: number;
  figures?: OcrFigure[];
  layoutBlocks?: OcrLayoutBlock[];
}

export interface OcrAdapter {
  name: EngineName;
  isAvailable(): Promise<boolean>;
  processPage(
    imagePath: string,
    options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    }
  ): Promise<OcrResult>;
}

export type PageEngineName = EngineName | 'native';

export interface DraftPage {
  pageNumber: number;
  imagePath: string;
  nativeText: string;
  markdown: string;
  accepted: boolean;
  status?: 'accepted' | 'pending' | 'failed';
  engine: PageEngineName;
  confidence?: number;
  figures?: OcrFigure[];
  layoutBlocks?: OcrLayoutBlock[];
  qualityWarnings?: PageQualityWarning[];
}

export interface DraftJob {
  id: string;
  sourcePdfPath: string;
  status: 'pending_review' | 'committed' | 'discarded';
  createdAt: string;
  updatedAt: string;
  pages: DraftPage[];
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

export interface GlmOcrEngineConfig {
  kind: 'glm-ocr';
  mode: 'selfhosted' | 'mlx';
  apiHost?: string;
  apiPort?: number;
  model?: string;
}

export type EngineConfig =
  | TesseractEngineConfig
  | DeepseekOcrEngineConfig
  | GlmOcrEngineConfig;

export type EngineName = EngineConfig['kind'];

export interface AppConfig {
  inboxPath: string;
  jobStorePath: string;
  host: string;
  port: number;
  defaultEngine: EngineName;
  nativeTextMinChars: number;
  textExtractionMode: 'auto' | 'ocr';
  engines: Partial<Record<EngineName, EngineConfig>>;
}
