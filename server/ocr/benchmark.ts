export type OcrBenchmarkScore = {
  expectedCharacters: number;
  recognisedCharacters: number;
  characterErrorRate: number;
  fidelity: number;
};

/**
 * Normalise model formatting differences before comparing recognised document
 * text with the corpus transcription. Layout is reported separately by hand.
 */
export function normaliseBenchmarkText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[`*_>#|[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreOcrBenchmark(
  expected: string,
  recognised: string,
): OcrBenchmarkScore {
  const expectedText = normaliseBenchmarkText(expected);
  const recognisedText = normaliseBenchmarkText(recognised);
  const distance = levenshteinDistance(expectedText, recognisedText);
  const expectedCharacters = expectedText.length;
  const recognisedCharacters = recognisedText.length;
  const denominator = Math.max(expectedCharacters, recognisedCharacters, 1);
  const characterErrorRate = distance / denominator;

  return {
    expectedCharacters,
    recognisedCharacters,
    characterErrorRate,
    fidelity: 1 - characterErrorRate,
  };
}

function levenshteinDistance(left: string, right: string): number {
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] +
        Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
    }

    previous = current;
  }

  return previous[right.length];
}
