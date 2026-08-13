import path from 'node:path';

import { toMarkdown } from '@firecrawl/anydoc';

export const ANYDOC_EXTENSIONS: readonly string[] = [
  '.doc',
  '.docx',
  '.docm',
  '.ppt',
  '.pps',
  '.pot',
  '.pptx',
  '.pptm',
  '.ppsx',
  '.ppsm',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  '.epub',
];

export function isAnydocSupportedExtension(filePath: string): boolean {
  return ANYDOC_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export class DocumentConversionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentConversionError';
  }
}

export async function convertDocumentToMarkdown(
  filePath: string,
): Promise<{ markdown: string }> {
  try {
    const result = await toMarkdown(filePath);
    return { markdown: result };
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === 'unsupported') {
      const message = filePath.toLowerCase().endsWith('.pdf')
        ? 'This PDF has no extractable text layer. Use page-by-page review instead.'
        : 'Unsupported or unrecognized document format.';
      throw new DocumentConversionError(422, message);
    }

    const messages: Record<string, string> = {
      malformed: 'This document could not be parsed; it may be corrupted.',
      encrypted:
        'This document is password-protected or encrypted and cannot be converted.',
      resourceLimit: 'This document exceeded a safety limit during conversion.',
      missingPart:
        'This document is missing required internal data and could not be converted.',
      io: 'Failed to read the document file.',
    };

    if (typeof code === 'string' && code in messages) {
      throw new DocumentConversionError(code === 'io' ? 500 : 422, messages[code]);
    }

    throw error;
  }
}
