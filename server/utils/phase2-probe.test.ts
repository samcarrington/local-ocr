import { readFile, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureProbeRtfTemp,
  pickFirstDocument,
  pickFirstPdf,
  resolveProbeConfigPath,
  withTimeout,
} from './phase2-probe.js';

describe('probe utils', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('picks first matching pdf and supported document', () => {
    const files = ['z.txt', 'A.PDF', 'memo.docx', 'sheet.csv'];
    expect(pickFirstPdf(files)).toBe('A.PDF');
    expect(pickFirstDocument(files)).toBe('memo.docx');
  });

  it('resolves config path from env override and fallback', () => {
    vi.stubEnv('OCRTOOL_CONFIG_PATH', '/tmp/custom.yaml');
    expect(resolveProbeConfigPath()).toContain('/tmp/custom.yaml');
    vi.unstubAllEnvs();
    expect(resolveProbeConfigPath()).toContain('ocrtool.config.yaml');
  });

  it('times out long-running work', async () => {
    await expect(withTimeout(new Promise<string>(() => undefined), 10, 'timeout check')).rejects.toThrow('timeout check');
  });

  it('creates temporary fallback RTF probe file', async () => {
    const filePath = await ensureProbeRtfTemp();
    const content = await readFile(filePath, 'utf8');
    expect(content).toContain('Phase 2 Nuxt Nitro probe document');
    await rm(filePath, { force: true });
  });
});
