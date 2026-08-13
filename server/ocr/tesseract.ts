import { existsSync } from 'node:fs';
import path from 'node:path';

import { createWorker } from 'tesseract.js';

import type {
  OcrAdapter,
  OcrResult,
  TesseractEngineConfig,
} from '../core/types.js';

type TesseractRecognizeResult = {
  data?: {
    text?: string;
    confidence?: number;
  };
};

interface ValidatedTrainedData {
  langPath: string;
  gzip: boolean;
}

export class TesseractOcrAdapter implements OcrAdapter {
  readonly name = 'tesseract';
  readonly capabilities = { outputFormats: ['markdown'] as const };

  constructor(private readonly config: TesseractEngineConfig) {}

  async isAvailable(): Promise<boolean> {
    return this.getValidatedTrainedDataPath() !== undefined;
  }

  async processPage(
    imagePath: string,
    options?: {
      mode?: 'markdown' | 'plain' | 'layout';
    },
  ): Promise<OcrResult> {
    const trainedData = this.getValidatedTrainedDataPath(true);
    if (!trainedData) {
      throw new Error('Tesseract traineddata validation failed');
    }
    const worker = await createWorker(this.config.lang, 1, {
      langPath: trainedData.langPath,
      gzip: trainedData.gzip,
      cacheMethod: 'none',
    });

    try {
      const result = (await worker.recognize(
        imagePath,
      )) as TesseractRecognizeResult;
      const text = normalizeText(result.data?.text ?? '', options?.mode);
      const confidence = normalizeConfidence(result.data?.confidence);

      return {
        markdown: text,
        ...(confidence === undefined ? {} : { confidence }),
      };
    } finally {
      await worker.terminate();
    }
  }

  private getValidatedTrainedDataPath(
    throwOnError = false,
  ): ValidatedTrainedData | undefined {
    const configuredPath = this.config.trainedDataPath?.trim();

    if (!configuredPath) {
      return this.handleConfigError(
        'Tesseract requires engines.tesseract.trainedDataPath pointing to local traineddata assets. Remote download fallback is disabled.',
        throwOnError,
      );
    }

    if (/^https?:\/\//i.test(configuredPath)) {
      return this.handleConfigError(
        `Tesseract trainedDataPath must be local filesystem path, received URL: ${configuredPath}`,
        throwOnError,
      );
    }

    const trainedDataFile = path.join(
      configuredPath,
      `${this.config.lang}.traineddata`,
    );
    const compressedTrainedDataFile = `${trainedDataFile}.gz`;

    if (existsSync(trainedDataFile)) {
      return { langPath: configuredPath, gzip: false };
    }

    if (existsSync(compressedTrainedDataFile)) {
      return { langPath: configuredPath, gzip: true };
    }

    return this.handleConfigError(
      `Tesseract traineddata missing: ${trainedDataFile} or ${compressedTrainedDataFile}`,
      throwOnError,
    );
  }

  private handleConfigError(message: string, throwOnError: boolean): undefined {
    if (throwOnError) {
      throw new Error(message);
    }

    return undefined;
  }
}

function normalizeText(
  text: string,
  mode: 'markdown' | 'plain' | 'layout' = 'markdown',
): string {
  const trimmed = text.trim();

  if (mode === 'plain') {
    return trimmed;
  }

  return trimmed;
}

function normalizeConfidence(
  confidence: number | undefined,
): number | undefined {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return undefined;
  }

  return confidence > 1 ? confidence / 100 : confidence;
}
