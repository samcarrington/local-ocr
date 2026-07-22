import { mkdtempSync, writeFileSync } from 'node:fs';
import { access, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deleteJob, listJobs, loadJob, saveJob } from './job-store.js';
import type { AppConfig, DraftJob } from './types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'local-ocr-job-store-'));
  tempDirs.push(dir);
  return dir;
}

function makeConfig(rootDir: string): AppConfig {
  return {
    inboxPath: path.join(rootDir, 'inbox'),
    jobStorePath: path.join(rootDir, '.ocrtool', 'jobs'),
    host: '127.0.0.1',
    port: 4312,
    defaultEngine: 'tesseract',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      tesseract: {
        kind: 'tesseract',
        lang: 'eng',
      },
    },
  };
}

function makeJob(id: string): DraftJob {
  return {
    id,
    sourcePdfPath: `/tmp/${id}.pdf`,
    status: 'pending_review',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    pages: [
      {
        pageNumber: 1,
        imagePath: `/tmp/${id}-1.png`,
        nativeText: '',
        markdown: `# ${id}`,
        accepted: true,
        status: 'accepted',
        engine: 'tesseract',
        confidence: 0.99,
        layoutBlocks: [
          {
            type: 'text',
            bbox: [1, 2, 3, 4],
            text: 'stored block',
          },
        ],
        qualityWarnings: [
          {
            type: 'low-native-coverage',
            severity: 'warning',
            message: 'Check OCR completeness',
            coverage: 0.5,
            missingSnippets: ['missing text'],
          },
        ],
      },
    ],
  };
}

describe('job store', () => {
  it('saves and loads jobs from json store', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const job = makeJob('job/one');

    await saveJob(config, job);

    const loaded = await loadJob(config, job.id);
    const stored = await readFile(
      path.join(config.jobStorePath, 'job%2Fone.json'),
      'utf8',
    );

    expect(loaded).toEqual(job);
    expect(stored.endsWith('\n')).toBe(true);
    expect(JSON.parse(stored)).toEqual(job);
    expect(
      (await readdir(config.jobStorePath)).filter((entry) =>
        entry.endsWith('.tmp'),
      ),
    ).toEqual([]);
  });

  it('lists jobs in deterministic id order', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);

    await saveJob(config, makeJob('b-job'));
    await saveJob(config, makeJob('a-job'));

    const jobs = await listJobs(config);

    expect(jobs.map((job) => job.id)).toEqual(['a-job', 'b-job']);
  });

  it('deletes jobs and tolerates missing entries', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);
    const job = makeJob('gone');

    await saveJob(config, job);

    await expect(deleteJob(config, job.id)).resolves.toBe(true);
    await expect(deleteJob(config, job.id)).resolves.toBe(false);
    await expect(loadJob(config, job.id)).resolves.toBeNull();
    await expect(
      access(path.join(config.jobStorePath, 'gone.json')),
    ).rejects.toThrow();
  });

  it('returns empty list when store path missing', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);

    expect(await listJobs(config)).toEqual([]);
  });

  it('skips corrupt job json while listing parseable jobs', async () => {
    const rootDir = makeTempDir();
    const config = makeConfig(rootDir);

    await saveJob(config, makeJob('good-job'));
    writeFileSync(
      path.join(config.jobStorePath, 'bad-job.json'),
      '{nope',
      'utf8',
    );

    const jobs = await listJobs(config);

    expect(jobs.map((job) => job.id)).toEqual(['good-job']);
  });
});
