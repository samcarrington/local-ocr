/**
 * Launch a local mlx-vlm OpenAI-compatible server serving GLM-OCR for the
 * `glm-ocr` engine. Run via `npm run serve:glm-ocr`.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

import { getEngineConfig, loadConfig } from '../src/core/config.js';
import { formatHttpHost, isLocalHost } from '../src/ocr/local-host.js';

const DEFAULT_SERVER_HOST = 'http://127.0.0.1:8080';
const DEFAULT_MODEL = 'mlx-community/GLM-OCR-bf16';
const DEFAULT_PORT = 8080;

interface CliArgs {
  configPath?: string;
  model?: string;
  host?: string;
  port?: number;
  python?: string;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${flag}`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case '--config':
        args.configPath = readValue();
        break;
      case '--model':
        args.model = readValue();
        break;
      case '--host':
        args.host = readValue();
        break;
      case '--port':
        args.port = parsePort(readValue());
        break;
      case '--python':
        args.python = readValue();
        break;
      case '--dry-run':
      case '--print-command':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  return args;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

const HELP = `Launch a local mlx-vlm server serving GLM-OCR for the glm-ocr engine.

Usage: npm run serve:glm-ocr -- [options]

Options:
  --config <path>   Config file to read defaults from (default: ocrtool.config.yaml)
  --model <id>      Model id to serve (default: glm-ocr.model or ${DEFAULT_MODEL})
  --host <host>     Bind host, must be loopback (default: from glm-ocr.serverHost)
  --port <port>     Bind port (default: from glm-ocr.serverHost or ${DEFAULT_PORT})
  --python <bin>    Python executable (default: $PYTHON or python3)
  --dry-run         Print the resolved command without launching
  -h, --help        Show this help
`;

function resolveServerHost(configPath?: string): string {
  try {
    const config = loadConfig(configPath);
    return getEngineConfig(config, 'glm-ocr')?.serverHost ?? DEFAULT_SERVER_HOST;
  } catch (error) {
    if (configPath) {
      throw error;
    }
    return DEFAULT_SERVER_HOST;
  }
}

function resolveModel(configPath: string | undefined, override?: string): string {
  if (override) {
    return override;
  }
  try {
    const config = loadConfig(configPath);
    return getEngineConfig(config, 'glm-ocr')?.model ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const serverHost = resolveServerHost(args.configPath);
  const parsed = new URL(serverHost);
  const host = args.host ?? parsed.hostname;
  const port = args.port ?? (parsed.port ? parsePort(parsed.port) : DEFAULT_PORT);
  const model = resolveModel(args.configPath, args.model);
  const python = args.python ?? process.env.PYTHON ?? 'python3';

  const localServerUrl = formatHttpHost(host, port);

  if (!isLocalHost(localServerUrl)) {
    process.stderr.write(`Refusing to bind non-local host "${host}". Use localhost, 127.0.0.1, or ::1.\n`);
    process.exit(1);
  }

  const serverArgs = ['-m', 'mlx_vlm.server', '--host', host, '--port', String(port), '--model', model];

  if (args.dryRun) {
    process.stdout.write(`${python} ${serverArgs.join(' ')}\n`);
    return;
  }

  process.stderr.write(`Starting mlx-vlm server: ${model} on ${localServerUrl}\n`);

  const child = spawn(python, serverArgs, { stdio: 'inherit' });

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      process.stderr.write(
        `Could not run "${python}". Install Python 3 and mlx-vlm (pip install mlx-vlm), ` +
          `or pass --python <bin>.\n`
      );
    } else {
      process.stderr.write(`Failed to start mlx-vlm server: ${error.message}\n`);
    }
    process.exit(1);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }

  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
