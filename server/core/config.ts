import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import type { AppConfig, EngineConfig, EngineName } from './types.js';

export const DEFAULT_CONFIG_FILE = 'ocrtool.config.yaml';
let deprecatedListenerConfigWarningShown = false;

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

const deepseekVlmEngineSchema = z
  .object({
    kind: z.literal('deepseek-ocr-vlm'),
    serverHost: z.string().min(1).default('http://127.0.0.1:8080'),
    model: z.string().min(1).default('mlx-community/DeepSeek-OCR-2-8bit'),
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
    'deepseek-ocr-vlm': deepseekVlmEngineSchema.optional(),
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
    defaultEngine: z
      .enum([
        'tesseract',
        'deepseek-ocr',
        'deepseek-ocr-vlm',
        'glm-ocr',
        'nuextract3-ocr',
      ])
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

function parseConfigFile(configPath: string): {
  config: unknown;
  hasDeprecatedListenerConfig: boolean;
} {
  const source = readFileSync(configPath, 'utf8');
  const parsed = parse(source);

  if (!isConfigObject(parsed)) {
    return { config: parsed ?? {}, hasDeprecatedListenerConfig: false };
  }

  const hasDeprecatedListenerConfig =
    Object.hasOwn(parsed, 'host') || Object.hasOwn(parsed, 'port');
  const { host: _host, port: _port, ...config } = parsed;

  return { config, hasDeprecatedListenerConfig };
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

  const parsed = parseConfigFile(resolved.configPath);

  if (parsed.hasDeprecatedListenerConfig) {
    warnDeprecatedListenerConfig();
  }

  return rawConfigSchema.parse(parsed.config);
}

export function getEngineConfig<T extends EngineName>(
  config: AppConfig,
  engineName: T,
): Extract<EngineConfig, { kind: T }> | undefined {
  return config.engines[engineName] as
    | Extract<EngineConfig, { kind: T }>
    | undefined;
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function warnDeprecatedListenerConfig(): void {
  if (deprecatedListenerConfigWarningShown) {
    return;
  }

  deprecatedListenerConfigWarningShown = true;
  console.warn(
    'The "host" and "port" YAML keys are deprecated and ignored. Use NITRO_HOST and NITRO_PORT to configure the listener.',
  );
}
