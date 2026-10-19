import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ConfigError, parseConfig } from './config.js';
import { logError, logInfo } from './logger.js';
import { startServer } from './server.js';

function loadLocalEnv(): void {
  if (process.env.RUNNING_IN_DOCKER === 'true') {
    return;
  }
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (file) {
    dotenv.config({ path: file });
  }
}

loadLocalEnv();

try {
  const config = parseConfig(process.env);
  const running = await startServer(config);
  logInfo(`Demo mode is active. Database boot count is ${running.context.bootCount}.`);

  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
} catch (error) {
  if (error instanceof ConfigError) {
    logError(error.message);
  } else {
    logError('OptionScout failed to start.');
  }
  process.exit(1);
}
