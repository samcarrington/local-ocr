import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG_FILE, loadConfig } from './config.js';

const originalCwd = process.cwd();
const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

afterEach(() => {
  process.chdir(originalCwd);

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('loadConfig', () => {
  it('returns safe defaults when cwd config is missing', () => {
    const dir = makeTempDir();
    process.chdir(dir);

    expect(loadConfig()).toEqual({
      inboxPath: './inbox',
      jobStorePath: './.ocrtool/jobs',
      host: '127.0.0.1',
      port: 4312,
      defaultEngine: 'tesseract',
      nativeTextMinChars: 24,
      textExtractionMode: 'auto',
      engines: {
        tesseract: {
          kind: 'tesseract',
          lang: 'eng'
        }
      }
    });
  });

  it('loads yaml overrides from explicit path', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, DEFAULT_CONFIG_FILE);

    writeFileSync(
      configPath,
      [
        'inboxPath: ./custom-inbox',
        'jobStorePath: ./.state/jobs',
        'host: 0.0.0.0',
        'port: 9999',
        'defaultEngine: deepseek-ocr',
        'nativeTextMinChars: 42',
        'textExtractionMode: ocr',
        'engines:',
        '  tesseract:',
        '    kind: tesseract',
        '    lang: deu',
        '    trainedDataPath: ./tessdata',
        '  deepseek-ocr:',
        '    kind: deepseek-ocr',
        '    ollamaHost: http://localhost:11434',
        '    model: deepseek-ocr:latest',
        '    chatTimeoutMs: 240000',
        '    maxOutputTokens: 2048'
      ].join('\n')
    );

    expect(loadConfig(configPath)).toEqual({
      inboxPath: './custom-inbox',
      jobStorePath: './.state/jobs',
      host: '0.0.0.0',
      port: 9999,
      defaultEngine: 'deepseek-ocr',
      nativeTextMinChars: 42,
      textExtractionMode: 'ocr',
      engines: {
        tesseract: {
          kind: 'tesseract',
          lang: 'deu',
          trainedDataPath: './tessdata'
        },
        'deepseek-ocr': {
          kind: 'deepseek-ocr',
          ollamaHost: 'http://localhost:11434',
          model: 'deepseek-ocr:latest',
          chatTimeoutMs: 240000,
          maxOutputTokens: 2048
        }
      }
    });
  });

  it('parses a nuextract3-ocr engine and applies schema defaults', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, DEFAULT_CONFIG_FILE);

    writeFileSync(
      configPath,
      [
        'defaultEngine: nuextract3-ocr',
        'engines:',
        '  nuextract3-ocr:',
        '    kind: nuextract3-ocr'
      ].join('\n')
    );

    const config = loadConfig(configPath);

    expect(config.defaultEngine).toBe('nuextract3-ocr');
    expect(config.engines['nuextract3-ocr']).toEqual({
      kind: 'nuextract3-ocr',
      serverHost: 'http://127.0.0.1:8080',
      model: 'numind/NuExtract3-mlx-nvfp4',
      chatTimeoutMs: 180000,
      maxOutputTokens: 4096
    });
  });

  it('loads the shipped example config', () => {
    const config = loadConfig(path.join(repoRoot, 'ocrtool.config.example.yaml'));

    expect(config.defaultEngine).toBe('tesseract');
    expect(config.engines.tesseract).toMatchObject({
      kind: 'tesseract',
      lang: 'eng',
      trainedDataPath: './tessdata'
    });
    expect(config.engines['deepseek-ocr']).toMatchObject({
      kind: 'deepseek-ocr',
      model: 'deepseek-ocr',
      chatTimeoutMs: 180000,
      maxOutputTokens: 4096
    });
  });

  it('rejects defaultEngine values without matching engine config', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, DEFAULT_CONFIG_FILE);

    writeFileSync(
      configPath,
      [
        'defaultEngine: deepseek-ocr',
        'engines:',
        '  tesseract:',
        '    kind: tesseract',
        '    lang: eng'
      ].join('\n')
    );

    expect(() => loadConfig(configPath)).toThrow(/defaultEngine/);
  });

  it('rejects invalid field values', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, DEFAULT_CONFIG_FILE);

    writeFileSync(
      configPath,
      [
        'port: -1',
        'nativeTextMinChars: nope',
        'engines:',
        '  tesseract:',
        '    kind: tesseract',
        '    lang: eng'
      ].join('\n')
    );

    expect(() => loadConfig(configPath)).toThrow();
  });

  it('rejects stale snake_case config keys', () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, DEFAULT_CONFIG_FILE);

    writeFileSync(
      configPath,
      [
        'defaultEngine: deepseek-ocr',
        'engines:',
        '  deepseek-ocr:',
        '    kind: deepseek-ocr',
        '    ollama_host: http://localhost:11434',
        '    model: deepseek-ocr'
      ].join('\n')
    );

    expect(() => loadConfig(configPath)).toThrow(/Unrecognized key/);
  });
});
