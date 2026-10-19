import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config.js';

const secret = 'super-secret-refresh-value-xyz';

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PORT: '3180',
    BIND_HOST: '127.0.0.1',
    DATABASE_PATH: './data/optionscout.sqlite',
    DATA_MODE: 'demo',
    AUTH_MODE: 'local-owner',
    ENABLE_ORDER_EXECUTION: 'false',
    TELEMETRY_ENABLED: 'false',
    RUNNING_IN_DOCKER: 'false',
    STATIC_DIR: '',
    ...overrides,
  };
}

describe('application configuration', () => {
  it('accepts the local demo configuration', () => {
    const config = parseConfig(baseEnv());
    expect(config).toMatchObject({
      port: 3180,
      bindHost: '127.0.0.1',
      dataMode: 'demo',
      authMode: 'local-owner',
      liveEnabled: false,
      dxlinkLiveDiagnostic: false,
      finderLiveScan: false,
      smartScanLive: false,
      scheduledSyncEnabled: false,
      ordersEnabled: false,
      telemetryEnabled: false,
      staticDir: null,
    });
  });

  it('allows 0.0.0.0 only inside Docker', () => {
    expect(parseConfig(baseEnv({ RUNNING_IN_DOCKER: 'true', BIND_HOST: '0.0.0.0' })).bindHost).toBe('0.0.0.0');
    expect(() => parseConfig(baseEnv({ BIND_HOST: '0.0.0.0' }))).toThrow(ConfigError);
    expect(() => parseConfig(baseEnv({ BIND_HOST: '192.168.1.20' }))).toThrow(/loopback/i);
  });

  it('rejects live data, trading, telemetry, public auth, and external databases', () => {
    expect(() => parseConfig(baseEnv({ DATA_MODE: 'live' }))).toThrow(/DATA_MODE/);
    expect(() => parseConfig(baseEnv({ ENABLE_ORDER_EXECUTION: 'true' }))).toThrow(/ENABLE_ORDER_EXECUTION/);
    expect(() => parseConfig(baseEnv({ TELEMETRY_ENABLED: 'true' }))).toThrow(/TELEMETRY_ENABLED/);
    expect(() => parseConfig(baseEnv({ AUTH_MODE: 'public' }))).toThrow(/AUTH_MODE/);
    expect(() => parseConfig(baseEnv({ AUTH_MODE: 'local-open' }))).toThrow(/AUTH_MODE/);
    expect(() => parseConfig(baseEnv({ TASTYTRADE_SCHEDULED_SYNC: 'true' }))).toThrow(/SCHEDULED_SYNC/);
    expect(() => parseConfig(baseEnv({ DXLINK_LIVE_DIAGNOSTIC: 'yes' }))).toThrow(/DXLINK_LIVE_DIAGNOSTIC/);
    expect(parseConfig(baseEnv({ DXLINK_LIVE_DIAGNOSTIC: 'true' })).dxlinkLiveDiagnostic).toBe(true);
    expect(() => parseConfig(baseEnv({ FINDER_LIVE_SCAN: 'yes' }))).toThrow(/FINDER_LIVE_SCAN/);
    expect(parseConfig(baseEnv({ FINDER_LIVE_SCAN: 'true' })).finderLiveScan).toBe(true);
    expect(() => parseConfig(baseEnv({ SMART_SCAN_LIVE: 'yes' }))).toThrow(/SMART_SCAN_LIVE/);
    expect(parseConfig(baseEnv({ SMART_SCAN_LIVE: 'true' })).smartScanLive).toBe(true);
    expect(() =>
      parseConfig(baseEnv({ TASTYTRADE_ENABLE_LIVE: 'true' }), {
        secretFilePath: path.join(os.tmpdir(), 'optionscout-missing-secrets.env'),
      }),
    ).toThrow(/secret file/);
    expect(() => parseConfig(baseEnv({ DATABASE_PATH: 'postgres://localhost/optionscout' }))).toThrow(/SQLite/);
    expect(() => parseConfig(baseEnv({ NODE_ENV: 'production', PORT: '0' }))).toThrow(/PORT 0/);
  });

  it('rejects brokerage credentials without echoing the secret', () => {
    expect(() => parseConfig(baseEnv({ TASTYTRADE_REFRESH_TOKEN: secret }))).toThrow(ConfigError);
    try {
      parseConfig(baseEnv({ TASTYTRADE_REFRESH_TOKEN: secret, TASTYTRADE_CLIENT_SECRET: secret }));
      throw new Error('expected config to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain('TASTYTRADE_REFRESH_TOKEN');
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
