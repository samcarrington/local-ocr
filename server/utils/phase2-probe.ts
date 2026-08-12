import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isAnydocSupportedExtension } from '../convert/anydoc.js';

export function pickFirstPdf(files: string[]): string | null {
  return files.find((entry) => entry.toLowerCase().endsWith('.pdf')) ?? null;
}

export function pickFirstDocument(files: string[]): string | null {
  return files.find((entry) => !entry.toLowerCase().endsWith('.pdf') && isAnydocSupportedExtension(entry)) ?? null;
}

export function resolveProbeConfigPath(): string {
  return process.env.OCRTOOL_CONFIG_PATH
    ? path.resolve(process.env.OCRTOOL_CONFIG_PATH)
    : path.resolve(process.cwd(), 'ocrtool.config.yaml');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function ensureProbeRtfTemp(): Promise<string> {
  const filePath = path.join(tmpdir(), `local-ocr-phase2-probe-${randomUUID()}.rtf`);
  const rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 Phase 2 Nuxt Nitro probe document.}';
  await writeFile(filePath, rtf, 'utf8');
  return filePath;
}
