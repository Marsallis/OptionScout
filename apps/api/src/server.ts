import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ConfigError, type AppConfig } from './config.js';
import { openAppContext, type AppContext } from './context.js';
import { createApp } from './app.js';
import { logInfo } from './logger.js';

export interface RunningServer {
  port: number;
  baseUrl: string;
  context: AppContext;
  close(): Promise<void>;
}

export function assertWebBuild(config: AppConfig): void {
  if (!config.staticDir || !fs.existsSync(path.join(config.staticDir, 'index.html'))) {
    throw new ConfigError('The web build is missing. Build the frontend before starting in production.');
  }
}

export async function startServer(config: AppConfig): Promise<RunningServer> {
  if (config.nodeEnv === 'production') {
    assertWebBuild(config);
  }
  const context = await openAppContext(config);
  const app = createApp(context);
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.bindHost, () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logInfo(`OptionScout listening on http://${config.bindHost}:${port}`);

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    context,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      context.close();
    },
  };
}
