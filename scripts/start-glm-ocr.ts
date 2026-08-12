import { spawn } from 'node:child_process';
import process from 'node:process';

import { loadConfig } from '../server/core/config.js';
import {
  createGlmOcrLaunchPlan,
  preflightGlmOcrLauncher,
  waitForGlmOcrReadiness,
  type CommandRunner,
  type LaunchCommand,
} from '../server/core/native-glm-ocr-launcher.js';

type Child = ReturnType<typeof spawn>;

const HELP = `Start local GLM-OCR and the Nuxt development server.

Usage: pnpm start:glm-ocr

The launcher reads NUXT_OCRTOOL_CONFIG_PATH (or ocrtool.config.yaml), starts
the configured loopback mlx-vlm GLM-OCR server, waits for /v1/models to report
the configured model, then starts Nuxt on 127.0.0.1:3000 by default.

Environment:
  PYTHON                        Python interpreter containing mlx-vlm
  NUXT_OCRTOOL_CONFIG_PATH      OCR YAML configuration path
  NITRO_HOST                    Loopback listener host (default: 127.0.0.1)
  NITRO_PORT                    Listener port (default: 3000)
`;

const children = new Set<Child>();
let stopping = false;

function runCommand(command: string, args: string[]): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });

    child.once('error', reject);
    child.once('exit', (exitCode) => resolve({ exitCode }));
  });
}

const preflightRunner: CommandRunner = runCommand;

function start(command: LaunchCommand, environment?: NodeJS.ProcessEnv): Child {
  const child = spawn(
    command.command === 'pnpm' && process.platform === 'win32'
      ? 'pnpm.cmd'
      : command.command,
    command.args,
    {
      env: environment,
      stdio: 'inherit',
    },
  );
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function waitForExit(child: Child): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      exitCode: child.exitCode,
      signal: child.signalCode,
    });
  }

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function watchForStartupFailure(child: Child): {
  failure: Promise<void>;
  dispose: () => void;
} {
  let rejectFailure: (reason: Error) => void = () => undefined;
  const failure = new Promise<void>((_resolve, reject) => {
    rejectFailure = reject;
  });
  const onError = () =>
    rejectFailure(
      new Error(
        'GLM-OCR could not start. Check the selected Python environment and retry.',
      ),
    );
  const onExit = () =>
    rejectFailure(
      new Error(
        'GLM-OCR stopped before it became ready. Review mlx-vlm output and retry.',
      ),
    );

  child.once('error', onError);
  child.once('exit', onExit);

  return {
    failure,
    dispose: () => {
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    },
  };
}

function stopChildren(signal: NodeJS.Signals): void {
  stopping = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function exitCodeFor(
  result: { exitCode: number | null; signal: NodeJS.Signals | null },
): number {
  return result.exitCode ?? (result.signal ? 1 : 0);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  let plan: ReturnType<typeof createGlmOcrLaunchPlan>;
  try {
    plan = createGlmOcrLaunchPlan(
      loadConfig(process.env.NUXT_OCRTOOL_CONFIG_PATH),
    );
  } catch {
    throw new Error(
      'Could not prepare GLM-OCR launch. Configure engines.glm-ocr with a loopback serverHost and model, then retry.',
    );
  }

  await preflightGlmOcrLauncher(plan, preflightRunner);
  if (stopping) {
    return;
  }

  process.stderr.write('Starting local GLM-OCR server...\n');
  const model = start(plan.modelCommand);
  const startupWatcher = watchForStartupFailure(model);

  try {
    await Promise.race([
      waitForGlmOcrReadiness(plan),
      startupWatcher.failure,
    ]);
  } catch (error) {
    stopChildren('SIGTERM');
    if (stopping) {
      return;
    }
    throw error;
  } finally {
    startupWatcher.dispose();
  }

  if (stopping) {
    stopChildren('SIGTERM');
    return;
  }

  process.stderr.write('GLM-OCR is ready. Starting local Nuxt server...\n');
  const app = start(plan.appCommand, {
    ...process.env,
    ...plan.appEnvironment,
  });
  const modelExit = waitForExit(model).then((result) => ({
    name: 'GLM-OCR server',
    result,
  }));
  const appExit = waitForExit(app).then((result) => ({
    name: 'Nuxt server',
    result,
  }));

  try {
    const firstExit = await Promise.race([modelExit, appExit]);
    if (!stopping) {
      process.stderr.write(`${firstExit.name} stopped; stopping remaining process.\n`);
      stopChildren('SIGTERM');
      process.exitCode = exitCodeFor(firstExit.result);
    }

    await Promise.allSettled([modelExit, appExit]);
  } catch (error) {
    stopChildren('SIGTERM');
    await Promise.allSettled([modelExit, appExit]);
    throw error;
  }
}

const signalHandlers = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
  const handler = () => stopChildren(signal);
  process.once(signal, handler);
  return { signal, handler };
});

main()
  .catch((error) => {
    if (!stopping) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'GLM-OCR launcher failed.'}\n`,
      );
    }
    process.exitCode = 1;
  })
  .finally(() => {
    for (const { signal, handler } of signalHandlers) {
      process.removeListener(signal, handler);
    }
  });
