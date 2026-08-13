import { spawn } from 'node:child_process';
import process from 'node:process';

import { getEngineConfig, loadConfig } from '../server/core/config.js';
import {
  formatHttpHost,
  isLocalHost,
  normalizeBindHost,
} from '../server/ocr/local-host.js';

const DEFAULT_PORT = 8080;
const MLX_ENGINE_NAMES = [
  'deepseek-ocr-vlm',
  'glm-ocr',
  'nuextract3-ocr',
] as const;

type MlxEngineName = (typeof MLX_ENGINE_NAMES)[number];

interface CliArgs {
  engine?: MlxEngineName;
  configPath?: string;
  model?: string;
  host?: string;
  port?: number;
  python?: string;
  dryRun: boolean;
  help: boolean;
}

const HELP = `Launch a local mlx-vlm OpenAI-compatible server for a configured OCR engine.

Usage: pnpm serve:mlx-vlm -- --engine <engine> [options]

Engines:
  deepseek-ocr-vlm
  glm-ocr
  nuextract3-ocr

Options:
  --engine <name>   Configured MLX OCR engine to serve (required)
  --config <path>   Config file to read (default: ocrtool.config.yaml)
  --model <id>      Override the model configured for the engine
  --host <host>     Override the configured loopback bind host
  --port <port>     Override the configured bind port
  --python <bin>    Python executable (default: $PYTHON or python3)
  --dry-run         Print the resolved command without launching
  -h, --help        Show this help
`;

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
      case '--':
        break;
      case '--engine':
        args.engine = parseEngine(readValue());
        break;
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

function parseEngine(value: string): MlxEngineName {
  if ((MLX_ENGINE_NAMES as readonly string[]).includes(value)) {
    return value as MlxEngineName;
  }
  throw new Error(
    `Unsupported MLX engine "${value}". Use one of: ${MLX_ENGINE_NAMES.join(', ')}`,
  );
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function resolveEngineConfig(engine: MlxEngineName, configPath?: string) {
  const config = loadConfig(configPath);
  const engineConfig = getEngineConfig(config, engine);
  if (!engineConfig) {
    throw new Error(
      `Configure engines.${engine} before starting its mlx-vlm server.`,
    );
  }
  return engineConfig;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!args.engine) {
    throw new Error('--engine is required. Run with --help for supported engines.');
  }

  const config = resolveEngineConfig(args.engine, args.configPath);
  const parsed = new URL(config.serverHost);
  const host = normalizeBindHost(args.host ?? parsed.hostname);
  const port = args.port ?? (parsed.port ? parsePort(parsed.port) : DEFAULT_PORT);
  const model = args.model ?? config.model;
  const python = args.python ?? process.env.PYTHON ?? 'python3';
  const localServerUrl = formatHttpHost(host, port);

  if (!isLocalHost(localServerUrl)) {
    process.stderr.write(
      `Refusing to bind non-local host "${host}". Use localhost, 127.0.0.1, or ::1.\n`,
    );
    process.exit(1);
  }

  const serverArgs = [
    '-m',
    'mlx_vlm.server',
    '--host',
    host,
    '--port',
    String(port),
    '--model',
    model,
  ];

  if (args.dryRun) {
    process.stdout.write(`${python} ${serverArgs.join(' ')}\n`);
    return;
  }

  process.stderr.write(
    `Starting mlx-vlm server: ${model} on ${localServerUrl}\n`,
  );
  const child = spawn(python, serverArgs, { stdio: 'inherit' });

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      process.stderr.write(
        `Could not run "${python}". Install Python 3 and mlx-vlm (pip install -U mlx-vlm), or pass --python <bin>.\n`,
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
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
