import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCanvas } from '@napi-rs/canvas';

import { scoreOcrBenchmark } from '../server/ocr/benchmark.js';
import { assertLocalHost } from '../server/ocr/local-host.js';

type BenchmarkCase = {
  name: string;
  expected: string;
  image: Buffer;
};

type BenchmarkResult = {
  name: string;
  latencyMs: number;
  output: string | null;
  error: string | null;
  score: ReturnType<typeof scoreOcrBenchmark> | null;
};

type Options = {
  serverHost: string;
  model: string;
  prompt: string;
  corpusDir?: string;
  outputPath: string;
  timeoutMs: number;
  peakMemoryMb?: number;
};

const DEFAULT_PROMPT = 'Convert this document image into clean Markdown. Return only the transcription.';

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  assertLocalHost(options.serverHost, 'OCR benchmark requires a local server');
  const cases = options.corpusDir
    ? await readCorpus(options.corpusDir)
    : createSyntheticCorpus();

  if (cases.length === 0) {
    throw new Error('Benchmark corpus contains no .png/.txt pairs.');
  }

  const results: BenchmarkResult[] = [];
  for (const benchmarkCase of cases) {
    results.push(await runCase(options, benchmarkCase));
  }

  const successful = results.filter(
    (result): result is BenchmarkResult & { score: NonNullable<BenchmarkResult['score']> } =>
      result.score !== null,
  );
  const report = {
    model: options.model,
    serverHost: options.serverHost,
    prompt: options.prompt,
    corpus: options.corpusDir ?? 'synthetic-sanity-corpus',
    recordedAt: new Date().toISOString(),
    peakMemoryMb: options.peakMemoryMb ?? null,
    cases: results,
    summary: {
      total: results.length,
      failures: results.length - successful.length,
      meanLatencyMs: mean(successful.map((result) => result.latencyMs)),
      meanFidelity: mean(successful.map((result) => result.score.fidelity)),
    },
  };

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary));
}

async function runCase(
  options: Options,
  benchmarkCase: BenchmarkCase,
): Promise<BenchmarkResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(
      new URL('/v1/chat/completions', withTrailingSlash(options.serverHost)),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          max_tokens: 4096,
          stream: false,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: options.prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${benchmarkCase.image.toString('base64')}`,
                },
              },
            ],
          }],
        }),
        signal: controller.signal,
      },
    );
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        name: benchmarkCase.name,
        latencyMs,
        output: null,
        error: `HTTP ${response.status}: ${(await response.text()).trim()}`,
        score: null,
      };
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const output = payload.choices?.[0]?.message?.content;
    if (typeof output !== 'string' || output.trim().length === 0) {
      return {
        name: benchmarkCase.name,
        latencyMs,
        output: null,
        error: 'Response did not contain text content.',
        score: null,
      };
    }

    return {
      name: benchmarkCase.name,
      latencyMs,
      output,
      error: null,
      score: scoreOcrBenchmark(benchmarkCase.expected, output),
    };
  } catch (error) {
    return {
      name: benchmarkCase.name,
      latencyMs: Math.round(performance.now() - startedAt),
      output: null,
      error: error instanceof Error ? error.message : String(error),
      score: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readCorpus(corpusDir: string): Promise<BenchmarkCase[]> {
  const entries = await readdir(corpusDir, { withFileTypes: true });
  const images = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'),
  );

  return Promise.all(images.map(async (image) => {
    const name = image.name.slice(0, -'.png'.length);
    const [expected, source] = await Promise.all([
      readFile(path.join(corpusDir, `${name}.txt`), 'utf8'),
      readFile(path.join(corpusDir, image.name)),
    ]);
    return { name, expected, image: source };
  }));
}

function createSyntheticCorpus(): BenchmarkCase[] {
  return [
    renderCase('printed-text', [
      'LOCAL OCR BENCHMARK',
      'Accurate transcription matters.',
      'Paragraph two has numbers: 42, 1,024, and 2026.',
    ]),
    renderCase('table', [
      'Quarter Revenue',
      'Q1 120',
      'Q2 180',
      'Q3 210',
    ]),
    renderCase('two-columns', [
      'Left column: OCR must preserve reading order.',
      'Right column: headings and paragraphs remain distinct.',
    ], true),
    renderCase('french-text', [
      'Compte rendu local',
      'Le modele transcrit le texte sans service distant.',
    ]),
  ];
}

function renderCase(name: string, lines: string[], twoColumns = false): BenchmarkCase {
  const canvas = createCanvas(1400, 900);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.font = '42px sans-serif';

  if (twoColumns) {
    context.fillText(lines[0], 80, 160, 560);
    context.fillText(lines[1], 760, 160, 560);
  } else {
    lines.forEach((line, index) => context.fillText(line, 100, 150 + index * 110));
  }

  return {
    name,
    expected: lines.join('\n'),
    image: canvas.toBuffer('image/png'),
  };
}

function parseOptions(arguments_: string[]): Options {
  if (arguments_[0] === '--') {
    arguments_ = arguments_.slice(1);
  }

  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(usage());
    }
    values.set(key.slice(2), value);
  }

  const serverHost = values.get('server-host');
  const model = values.get('model');
  if (!serverHost || !model) {
    throw new Error(usage());
  }

  const timeoutMs = Number(values.get('timeout-ms') ?? '180000');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer.');
  }

  const peakMemoryMb = values.has('peak-memory-mb')
    ? Number(values.get('peak-memory-mb'))
    : undefined;
  if (peakMemoryMb !== undefined && (!Number.isFinite(peakMemoryMb) || peakMemoryMb < 0)) {
    throw new Error('--peak-memory-mb must be a non-negative number.');
  }

  return {
    serverHost,
    model,
    prompt: values.get('prompt') ?? DEFAULT_PROMPT,
    corpusDir: values.get('corpus'),
    outputPath: values.get('output') ??
      path.join('benchmark-results', `${safeFileName(model)}.json`),
    timeoutMs,
    peakMemoryMb,
  };
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
}

function usage(): string {
  return [
    'Usage: pnpm benchmark:ocr -- --server-host http://127.0.0.1:8080 --model MODEL',
    'Optional: --corpus DIR --prompt TEXT --output FILE --timeout-ms 180000 --peak-memory-mb 6320',
    'A corpus directory contains matching <name>.png and <name>.txt files.',
  ].join('\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
