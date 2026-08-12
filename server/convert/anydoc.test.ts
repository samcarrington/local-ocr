import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toMarkdown: vi.fn(),
}));

vi.mock('@firecrawl/anydoc', () => ({
  toMarkdown: mocks.toMarkdown,
}));

import {
  ANYDOC_EXTENSIONS,
  DocumentConversionError,
  convertDocumentToMarkdown,
  isAnydocSupportedExtension,
} from './anydoc.js';

describe('anydoc conversion wrapper', () => {
  it('recognizes every supported extension and rejects unsupported extensions', () => {
    for (const extension of ANYDOC_EXTENSIONS) {
      expect(isAnydocSupportedExtension(`document${extension}`)).toBe(true);
    }

    for (const filePath of ['document.csv', 'document.pdf', 'document.txt', 'document']) {
      expect(isAnydocSupportedExtension(filePath)).toBe(false);
    }
  });

  it('returns markdown from a successful conversion', async () => {
    mocks.toMarkdown.mockResolvedValueOnce('# Converted document');

    await expect(convertDocumentToMarkdown('document.docx')).resolves.toEqual({
      markdown: '# Converted document',
    });
    expect(mocks.toMarkdown).toHaveBeenCalledWith('document.docx');
  });

  it.each([
    [
      'malformed',
      422,
      'This document could not be parsed; it may be corrupted.',
    ],
    [
      'encrypted',
      422,
      'This document is password-protected or encrypted and cannot be converted.',
    ],
    ['resourceLimit', 422, 'This document exceeded a safety limit during conversion.'],
    [
      'missingPart',
      422,
      'This document is missing required internal data and could not be converted.',
    ],
    ['io', 500, 'Failed to read the document file.'],
  ])('maps %s conversion errors', async (code, status, message) => {
    const error = Object.assign(new Error(`native ${code}`), { code });
    mocks.toMarkdown.mockRejectedValueOnce(error);

    const result = convertDocumentToMarkdown('document.docx');
    await expect(result).rejects.toBeInstanceOf(DocumentConversionError);
    await expect(result).rejects.toMatchObject({ status, message });
  });

  it('uses a PDF-specific message for unsupported PDFs', async () => {
    const error = Object.assign(new Error('native unsupported'), {
      code: 'unsupported',
    });
    mocks.toMarkdown.mockRejectedValueOnce(error);

    await expect(convertDocumentToMarkdown('scan.PDF')).rejects.toMatchObject({
      status: 422,
      message: 'This PDF has no extractable text layer. Use page-by-page review instead.',
    });
  });

  it('uses a generic message for unsupported non-PDF documents', async () => {
    const error = Object.assign(new Error('native unsupported'), {
      code: 'unsupported',
    });
    mocks.toMarkdown.mockRejectedValueOnce(error);

    await expect(convertDocumentToMarkdown('document.bin')).rejects.toMatchObject({
      status: 422,
      message: 'Unsupported or unrecognized document format.',
    });
  });

  it('rethrows errors with unknown or missing codes unchanged', async () => {
    const unknownError = Object.assign(new Error('unexpected'), { code: 'other' });
    mocks.toMarkdown.mockRejectedValueOnce(unknownError);
    await expect(convertDocumentToMarkdown('document.docx')).rejects.toBe(unknownError);

    const missingCodeError = new Error('missing code');
    mocks.toMarkdown.mockRejectedValueOnce(missingCodeError);
    await expect(convertDocumentToMarkdown('document.docx')).rejects.toBe(missingCodeError);
  });
});
