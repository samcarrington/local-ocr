export type EngineName =
  | 'tesseract'
  | 'deepseek-ocr'
  | 'glm-ocr'
  | 'nuextract3-ocr';

export const OUTPUT_FORMATS = ['markdown', 'json', 'html'] as const;

export type OcrOutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface OcrEngineCapabilities {
  outputFormats: readonly OcrOutputFormat[];
}

export const MARKDOWN_ONLY_CAPABILITIES: OcrEngineCapabilities = {
  outputFormats: ['markdown'],
};

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

export type PageEngineName = EngineName | 'native' | 'anydoc';

export interface DraftPage {
  pageNumber: number;
  imagePath?: string;
  nativeText: string;
  markdown: string;
  outputFormat?: OcrOutputFormat;
  availableOutputFormats?: OcrOutputFormat[];
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
  kind: 'pdf-pages' | 'document';
  sourceFilePath: string;
  status: 'pending_review' | 'committed' | 'discarded';
  createdAt: string;
  updatedAt: string;
  pages: DraftPage[];
}
