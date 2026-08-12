import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import type { AppConfig, EngineConfig, EngineName } from './types.js';

export const DEFAULT_CONFIG_FILE = 'ocrtool.config.yaml';

const tesseractEngineSchema = z
  .object({
    kind: z.literal('tesseract'),
    lang: z.string().min(1).default('eng'),
    trainedDataPath: z.string().min(1).optional(),
  })
  .strict();

const deepseekEngineSchema = z
  .object({
    kind: z.literal('deepseek-ocr'),
    ollamaHost: z.string().min(1).default('http://127.0.0.1:11434'),
    model: z.string().min(1).default('deepseek-ocr'),
    chatTimeoutMs: z.number().int().min(1_000).default(180_000),
    maxOutputTokens: z.number().int().min(128).max(16_384).default(4096),
  })
  .strict();

const glmEngineSchema = z
  .object({
    kind: z.literal('glm-ocr'),
    serverHost: z.string().min(1).default('http://127.0.0.1:8080'),
    model: z.string().min(1).default('mlx-community/GLM-OCR-bf16'),
    chatTimeoutMs: z.number().int().min(1_000).default(180_000),
    maxOutputTokens: z.number().int().min(128).max(16_384).default(4096),
  })
  .strict();

const nuextract3EngineSchema = z
  .object({
    kind: z.literal('nuextract3-ocr'),
    serverHost: z.string().min(1).default('http://127.0.0.1:8080'),
    model: z.string().min(1).default('numind/NuExtract3-mlx-nvfp4'),
    chatTimeoutMs: z.number().int().min(1_000).default(180_000),
    maxOutputTokens: z.number().int().min(128).max(16_384).default(4096),
  })
  .strict();

const enginesSchema = z
  .object({
    tesseract: tesseractEngineSchema.optional(),
    'deepseek-ocr': deepseekEngineSchema.optional(),
    'glm-ocr': glmEngineSchema.optional(),
    'nuextract3-ocr': nuextract3EngineSchema.optional(),
  })
  .strict()
  .default({
    tesseract: {
      kind: 'tesseract',
      lang: 'eng',
    },
  });

const rawConfigSchema = z
  .object({
    inboxPath: z.string().min(1).default('./inbox'),
    jobStorePath: z.string().min(1).default('./.ocrtool/jobs'),
    host: z.string().min(1).default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(4312),
    defaultEngine: z
      .enum(['tesseract', 'deepseek-ocr', 'glm-ocr', 'nuextract3-ocr'])
      .default('tesseract'),
    nativeTextMinChars: z.number().int().min(0).default(24),
    textExtractionMode: z.enum(['auto', 'ocr']).default('auto'),
    engines: enginesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.engines[value.defaultEngine]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `defaultEngine "${value.defaultEngine}" must be configured in engines`,
        path: ['defaultEngine'],
      });
    }
  });

function parseConfigFile(configPath: string): unknown {
  const source = readFileSync(configPath, 'utf8');
  const parsed = parse(source);

  return parsed ?? {};
}

function resolveConfigPath(explicitPath?: string): {
  configPath: string;
  explicit: boolean;
} {
  if (explicitPath) {
    return {
      configPath: path.resolve(explicitPath),
      explicit: true,
    };
  }

  return {
    configPath: path.resolve(process.cwd(), DEFAULT_CONFIG_FILE),
    explicit: false,
  };
}

export function loadConfig(configPath?: string): AppConfig {
  const resolved = resolveConfigPath(configPath);

  if (!existsSync(resolved.configPath)) {
    if (resolved.explicit) {
      throw new Error(`Config file not found: ${resolved.configPath}`);
    }

    return rawConfigSchema.parse({});
  }

  return rawConfigSchema.parse(parseConfigFile(resolved.configPath));
}

export function getEngineConfig<T extends EngineName>(
  config: AppConfig,
  engineName: T,
): Extract<EngineConfig, { kind: T }> | undefined {
  return config.engines[engineName] as
    | Extract<EngineConfig, { kind: T }>
    | undefined;
}
