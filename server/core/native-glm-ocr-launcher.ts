import type { AppConfig } from './types.js';
import {
  formatHttpHost,
  isLocalHost,
  normalizeBindHost,
} from '../ocr/local-host.js';

const DEFAULT_MODEL_PORT = 8080;
const DEFAULT_APP_HOST = '127.0.0.1';
const DEFAULT_APP_PORT = 3000;

export interface LauncherEnvironment {
  PYTHON?: string;
  NITRO_HOST?: string;
  NITRO_PORT?: string;
}

export interface LaunchCommand {
  command: string;
  args: string[];
}

export interface GlmOcrLaunchPlan {
  model: string;
  modelServerUrl: string;
  healthUrl: string;
  modelCommand: LaunchCommand;
  appCommand: LaunchCommand;
  appEnvironment: {
    NITRO_HOST: string;
    NITRO_PORT: string;
  };
}

export interface CommandResult {
  exitCode: number | null;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

export type ReadinessFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ReadinessOptions {
  attempts?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function createGlmOcrLaunchPlan(
  config: AppConfig,
  environment: LauncherEnvironment = process.env,
): GlmOcrLaunchPlan {
  const engine = config.engines['glm-ocr'];

  if (!engine || engine.kind !== 'glm-ocr') {
    throw new Error(
      'GLM-OCR is not configured. Add an engines.glm-ocr entry to the OCR YAML configuration.',
    );
  }

  const model = engine.model.trim();
  if (!model) {
    throw new Error('GLM-OCR requires a non-empty model setting.');
  }

  const modelServer = parseLoopbackServer(engine.serverHost, 'GLM-OCR server');
  const appHost = parseLoopbackHost(
    environment.NITRO_HOST ?? DEFAULT_APP_HOST,
    'NITRO_HOST',
  );
  const appPort = parsePort(
    environment.NITRO_PORT ?? String(DEFAULT_APP_PORT),
    'NITRO_PORT',
  );
  const python = environment.PYTHON?.trim() || 'python3';
  const modelServerUrl = formatHttpHost(modelServer.host, modelServer.port);

  return {
    model,
    modelServerUrl,
    healthUrl: new URL('/health', modelServerUrl).toString(),
    modelCommand: {
      command: python,
      args: [
        '-m',
        'mlx_vlm.server',
        '--host',
        modelServer.host,
        '--port',
        String(modelServer.port),
        '--model',
        model,
      ],
    },
    appCommand: {
      command: 'pnpm',
      args: [
        'exec',
        'nuxt',
        'dev',
        '--host',
        appHost,
        '--port',
        String(appPort),
      ],
    },
    appEnvironment: {
      NITRO_HOST: appHost,
      NITRO_PORT: String(appPort),
    },
  };
}

export async function preflightGlmOcrLauncher(
  plan: GlmOcrLaunchPlan,
  runCommand: CommandRunner,
): Promise<void> {
  try {
    const result = await runCommand(plan.modelCommand.command, [
      '-c',
      'import mlx_vlm',
    ]);

    if (result.exitCode === 0) {
      return;
    }
  } catch {
    // The recovery guidance below covers an unavailable interpreter too.
  }

  throw new Error(
    'GLM-OCR preflight failed. Install Python 3 and mlx-vlm in the selected Python environment, then retry.',
  );
}

export async function waitForGlmOcrReadiness(
  plan: GlmOcrLaunchPlan,
  fetcher: ReadinessFetcher = fetch,
  options: ReadinessOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 30;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_500;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await isConfiguredModelLoaded(plan, fetcher, requestTimeoutMs)) {
      return;
    }

    if (attempt < attempts) {
      await sleep(retryDelayMs);
    }
  }

  throw new Error(
    'GLM-OCR did not become ready. Check that mlx-vlm can load the configured model, then retry.',
  );
}

function parseLoopbackServer(
  serverHost: string,
  label: string,
): { host: string; port: number } {
  let url: URL;

  try {
    url = new URL(serverHost);
  } catch {
    throw new Error(`${label} must be a loopback HTTP URL.`);
  }

  if (url.protocol !== 'http:' || !isLocalHost(serverHost)) {
    throw new Error(`${label} must use a loopback host.`);
  }

  return {
    host: normalizeBindHost(url.hostname),
    port: url.port ? parsePort(url.port, `${label} port`) : DEFAULT_MODEL_PORT,
  };
}

function parseLoopbackHost(value: string, settingName: string): string {
  const host = normalizeBindHost(value);

  if (!isLocalHost(formatHttpHost(host, DEFAULT_APP_PORT))) {
    throw new Error(`${settingName} must be localhost, 127.0.0.1, or ::1.`);
  }

  return host;
}

function parsePort(value: string, settingName: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${settingName} must be a valid TCP port.`);
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${settingName} must be a valid TCP port.`);
  }

  return port;
}

async function isConfiguredModelLoaded(
  plan: GlmOcrLaunchPlan,
  fetcher: ReadinessFetcher,
  requestTimeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetcher(plan.healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    return isConfiguredModelLoadedByHealthCheck(await response.json(), plan.model);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isConfiguredModelLoadedByHealthCheck(
  payload: unknown,
  model: string,
): boolean {
  if (!isObject(payload) || typeof payload.loaded_model !== 'string') {
    return false;
  }

  return payload.loaded_model.trim().toLowerCase() === model.toLowerCase();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
