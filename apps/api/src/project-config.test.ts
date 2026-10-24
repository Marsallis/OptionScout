import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('repository configuration', () => {
  it('publishes only the loopback port and persists SQLite on a volume', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toContain('127.0.0.1:${OPTIONSCOUT_PORT:-3180}:3180');
    expect(compose).not.toMatch(/["']0\.0\.0\.0:\d+:3180["']/);
    expect(compose).not.toMatch(/^\s*-\s*["']?3180:3180["']?\s*$/m);
    expect(compose.toLowerCase()).not.toContain('postgres');
    expect(compose.toLowerCase()).not.toContain('redis');
    expect(compose).toContain('optionscout-data:/data');
    expect(compose).not.toContain('DXLINK_LIVE_DIAGNOSTIC=true');
    expect(compose).toMatch(/FINDER_LIVE_SCAN:\s*"\$\{FINDER_LIVE_SCAN:-false\}"/);
    expect(compose).toMatch(/SMART_SCAN_LIVE:\s*"\$\{SMART_SCAN_LIVE:-false\}"/);
    expect(compose).toMatch(/ENABLE_ORDER_EXECUTION:\s*"false"/);
    expect(compose).toMatch(/TASTYTRADE_SCHEDULED_SYNC:\s*"false"/);
    expect(compose).toMatch(/TASTYTRADE_ENABLE_LIVE:\s*"\$\{TASTYTRADE_ENABLE_LIVE:-false\}"/);
    expect(read('docker/Dockerfile')).toContain('DATABASE_PATH=/data/optionscout.sqlite');
    const hosted = read('docker/Dockerfile.hosted');
    expect(hosted).toContain('cp apps/api/src/hosted-lock.public.ts apps/api/src/hosted-lock.ts && npm run build');
    expect(read('apps/api/src/hosted-lock.ts')).toContain('export const hostedPublicDemo = false');
    expect(read('apps/api/src/hosted-lock.public.ts')).toContain('export const hostedPublicDemo = true');
  });

  it('keeps secrets and database files out of git and sample env', () => {
    const ignore = read('.gitignore');
    for (const entry of ['.env', 'secrets/', '*.sqlite', 'data/']) {
      expect(ignore).toContain(entry);
    }
    const example = read('.env.example');
    expect(example).toContain('DATA_MODE=demo');
    expect(example).toContain('BIND_HOST=127.0.0.1');
    expect(example).toContain('ENABLE_ORDER_EXECUTION=false');
    expect(example).toContain('TELEMETRY_ENABLED=false');
    expect(example).not.toMatch(/=\s*(sk-|ghp_|xox[baprs]-)/);
    expect(example.toLowerCase()).not.toContain('refresh_token=');
    expect(example.toLowerCase()).not.toContain('client_secret=');
  });

  it('does not reference live brokerage hosts in application source', () => {
    const files = [
      ...sourceFiles(path.join(root, 'apps')),
      ...sourceFiles(path.join(root, 'packages')),
    ];
    const banned = ['api.tastyworks.com', 'api.cert.tastyworks.com', 'dxfeed.com', 'my.tastytrade.com'];
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(root, file);
      if (relative.startsWith(`apps${path.sep}api${path.sep}src${path.sep}brokerage${path.sep}`)) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      for (const host of banned) {
        if (source.includes(host)) {
          offenders.push(`${path.relative(root, file)} contains ${host}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
