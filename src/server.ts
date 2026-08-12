import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { ApiDependencies } from './api.js';
import { createApiRouter, installJsonErrorHandler } from './api.js';
import { loadConfig } from '../server/core/config.js';
import type { AppConfig } from '../server/core/types.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

interface ListenerConfig {
  host: string;
  port: number;
}

export function createServer(
  config: AppConfig = loadConfig(),
  apiDependencies?: Partial<ApiDependencies>,
  listener: ListenerConfig = loadListenerConfig(),
) {
  assertLocalHost(listener.host);
  const app = express();
  const publicDir = path.resolve(process.cwd(), 'public');

  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api', createApiRouter(config, apiDependencies));

  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  app.get('/', (_req, res) => {
    if (existsSync(publicDir)) {
      res.sendFile(path.join(publicDir, 'index.html'));
      return;
    }

    res.json({ name: 'local-ocr', status: 'ok' });
  });

  installJsonErrorHandler(app);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const listener = loadListenerConfig();
  const app = createServer(config);

  app.listen(listener.port, listener.host, () => {
    console.log(
      `local-ocr scaffold listening on http://${listener.host}:${listener.port}`,
    );
  });
}

export function loadListenerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ListenerConfig {
  const host = environment.NITRO_HOST ?? '127.0.0.1';
  const configuredPort = environment.NITRO_PORT ?? '3000';
  const port = Number(configuredPort);

  assertLocalHost(host);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`NITRO_PORT must be an integer from 1 to 65535: ${configuredPort}`);
  }

  return { host, port };
}

function assertLocalHost(host: string): void {
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`host must be loopback/local only: ${host}`);
  }
}
