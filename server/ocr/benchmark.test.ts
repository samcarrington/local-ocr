import { describe, expect, it } from 'vitest';

import { normaliseBenchmarkText, scoreOcrBenchmark } from './benchmark.js';

describe('OCR benchmark scoring', () => {
  it('ignores Markdown and whitespace differences', () => {
    expect(normaliseBenchmarkText('## A *local* OCR\nreport')).toBe(
      'a local ocr report',
    );
    expect(
      scoreOcrBenchmark('## A local OCR report', 'A local\nOCR report'),
    ).toMatchObject({
      characterErrorRate: 0,
      fidelity: 1,
    });
  });

  it('reports the character error rate for a transcription error', () => {
    expect(scoreOcrBenchmark('table', 'cable')).toMatchObject({
      expectedCharacters: 5,
      recognisedCharacters: 5,
      characterErrorRate: 0.2,
      fidelity: 0.8,
    });
  });
});
