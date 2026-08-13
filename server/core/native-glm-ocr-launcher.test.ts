import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from './types.js';
import {
  createGlmOcrLaunchPlan,
  preflightGlmOcrLauncher,
  waitForGlmOcrReadiness,
} from './native-glm-ocr-launcher.js';

function makeConfig(): AppConfig {
  return {
    inboxPath: './inbox',
    jobStorePath: './.ocrtool/jobs',
    defaultEngine: 'glm-ocr',
    nativeTextMinChars: 24,
    textExtractionMode: 'auto',
    engines: {
      'glm-ocr': {
        kind: 'glm-ocr',
        serverHost: 'http://127.0.0.1:8181',
        model: 'local/GLM-OCR',
      },
    },
  };
}

describe('native GLM-OCR launcher', () => {
  it('builds model and Nuxt commands from the same OCR config', () => {
    const plan = createGlmOcrLaunchPlan(makeConfig(), {
      PYTHON: 'python-from-venv',
      NITRO_PORT: '4312',
    });

    expect(plan.modelServerUrl).toBe('http://127.0.0.1:8181');
    expect(plan.availabilityUrl).toBe('http://127.0.0.1:8181/v1/models');
    expect(plan.modelCommand).toEqual({
      command: 'python-from-venv',
      args: [
        '-m',
        'mlx_vlm.server',
        '--host',
        '127.0.0.1',
        '--port',
        '8181',
        '--model',
        'local/GLM-OCR',
      ],
    });
    expect(plan.appCommand).toEqual({
      command: 'pnpm',
      args: [
        'exec',
        'nuxt',
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        '4312',
      ],
    });
    expect(plan.appEnvironment).toEqual({
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '4312',
    });
  });

  it('rejects a missing GLM-OCR setting and non-loopback listener', () => {
    const missingEngine = makeConfig();
    missingEngine.engines = {};

    expect(() => createGlmOcrLaunchPlan(missingEngine)).toThrow(
      /GLM-OCR is not configured/,
    );
    expect(() =>
      createGlmOcrLaunchPlan(makeConfig(), { NITRO_HOST: '0.0.0.0' }),
    ).toThrow(/NITRO_HOST must be localhost/);
  });

  it('reports a failed mlx-vlm preflight without starting a model', async () => {
    const runCommand = vi.fn().mockResolvedValue({ exitCode: 1 });

    await expect(
      preflightGlmOcrLauncher(createGlmOcrLaunchPlan(makeConfig()), runCommand),
    ).rejects.toThrow(/GLM-OCR preflight failed/);
    expect(runCommand).toHaveBeenCalledWith('python3', [
      '-c',
      'import mlx_vlm',
    ]);
  });

  it('reports an unavailable Python executable as a preflight failure', async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error('ENOENT'));

    await expect(
      preflightGlmOcrLauncher(createGlmOcrLaunchPlan(makeConfig()), runCommand),
    ).rejects.toThrow(/Install Python 3 and mlx-vlm/);
  });

  it('waits for the configured model before starting Nuxt', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'other/model' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'local/glm-ocr' }] }), {
          status: 200,
        }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForGlmOcrReadiness(createGlmOcrLaunchPlan(makeConfig()), fetcher, {
        attempts: 2,
        sleep,
      }),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8181/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(sleep).toHaveBeenCalledWith(1_000);
  });
});
