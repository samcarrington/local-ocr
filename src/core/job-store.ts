import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { AppConfig, DraftJob } from './types.js';

const JOB_FILE_EXTENSION = '.json';

function getJobFileName(jobId: string): string {
  return `${encodeURIComponent(jobId)}${JOB_FILE_EXTENSION}`;
}

function getJobFilePath(config: AppConfig, jobId: string): string {
  return path.join(config.jobStorePath, getJobFileName(jobId));
}

function serializeJob(job: DraftJob): string {
  return `${JSON.stringify(
    {
      id: job.id,
      kind: job.kind,
      sourceFilePath: job.sourceFilePath,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      pages: job.pages.map((page) => ({
        pageNumber: page.pageNumber,
        imagePath: page.imagePath,
        nativeText: page.nativeText,
        markdown: page.markdown,
        accepted: page.accepted,
        status: page.status,
        engine: page.engine,
        confidence: page.confidence,
        figures: page.figures,
        layoutBlocks: page.layoutBlocks,
        qualityWarnings: page.qualityWarnings,
      })),
    },
    null,
    2,
  )}\n`;
}

function normalizeJob(raw: unknown): DraftJob {
  const job = raw as Record<string, unknown>;
  const normalized = { ...job };

  if (!('kind' in normalized)) {
    normalized.kind = 'pdf-pages';
  }

  if (!('sourceFilePath' in normalized) && 'sourcePdfPath' in normalized) {
    normalized.sourceFilePath = normalized.sourcePdfPath;
  }

  return normalized as unknown as DraftJob;
}

async function writeFileAtomic(
  filePath: string,
  contents: string,
): Promise<void> {
  const tempFilePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await writeFile(tempFilePath, contents, 'utf8');
  await rename(tempFilePath, filePath);
}

export async function saveJob(config: AppConfig, job: DraftJob): Promise<void> {
  await mkdir(config.jobStorePath, { recursive: true });
  await writeFileAtomic(getJobFilePath(config, job.id), serializeJob(job));
}

export async function loadJob(
  config: AppConfig,
  jobId: string,
): Promise<DraftJob | null> {
  try {
    const contents = await readFile(getJobFilePath(config, jobId), 'utf8');
    return normalizeJob(JSON.parse(contents));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function deleteJob(
  config: AppConfig,
  jobId: string,
): Promise<boolean> {
  try {
    await rm(getJobFilePath(config, jobId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function listJobs(config: AppConfig): Promise<DraftJob[]> {
  try {
    const entries = await readdir(config.jobStorePath, { withFileTypes: true });
    const jobFiles = entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith(JOB_FILE_EXTENSION),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const jobs = (
      await Promise.all(
        jobFiles.map(async (fileName) => {
          try {
            const contents = await readFile(
              path.join(config.jobStorePath, fileName),
              'utf8',
            );
            return normalizeJob(JSON.parse(contents));
          } catch (error) {
            if (error instanceof SyntaxError) {
              return null;
            }

            throw error;
          }
        }),
      )
    ).filter((job): job is DraftJob => job !== null);

    return jobs.sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}
