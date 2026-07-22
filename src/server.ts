import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { ApiDependencies } from './api.js';
import { createApiRouter, installJsonErrorHandler } from './api.js';
import { loadConfig } from './core/config.js';
import type { AppConfig } from './core/types.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function createServer(
  config: AppConfig = loadConfig(),
  apiDependencies?: Partial<ApiDependencies>,
) {
  assertLocalHost(config.host);
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
  const app = createServer(config);

  app.listen(config.port, config.host, () => {
    console.log(
      `local-ocr scaffold listening on http://${config.host}:${config.port}`,
    );
  });
}

function assertLocalHost(host: string): void {
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`host must be loopback/local only: ${host}`);
  }
}
