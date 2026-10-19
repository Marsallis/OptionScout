import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { marketDataObservations } from '../db/schema.js';
import type { FinderQuoteSnapshot } from './quotes.js';
import {
  OBSERVATION_RETENTION_DAYS,
  assessGreekVerification,
  classifyObservationFreshness,
  getObservationByStreamer,
  mergeLiveWithCache,
  pruneObservations,
  upsertObservationFromSnapshot,
} from './observations.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-obs-'));
  directories.push(dir);
  const opened = openDatabase(path.join(dir, 'test.sqlite'));
  const applied = applyMigrations(opened.sqlite, migrationsDirectory());
  expect(applied).toContain('0009_market_data_observations.sql');
  return opened;
}

function snapshot(overrides: Partial<FinderQuoteSnapshot> & Pick<FinderQuoteSnapshot, 'streamerSymbol'>): FinderQuoteSnapshot {
  return {
    bid: null,
    ask: null,
    mark: null,
    delta: null,
    theta: null,
    gamma: null,
    vega: null,
    impliedVolatility: null,
    volume: null,
    openInterest: null,
    providerEventAt: null,
    greekEventAt: null,
    receivedAt: '2026-10-15T14:00:00.000Z',
    sourceLabel: 'test-fixture',
    ...overrides,
  };
}

describe('upsertObservationFromSnapshot field-level merge', () => {
  it('lets newer provider timestamps win and blocks older overwrites; omissions preserve existing', () => {
    const opened = tempDb();
    try {
      const streamer = '.ZZT280121C100';
      upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: streamer,
          bid: '9.00',
          ask: '10.00',
          mark: '9.50',
          delta: '0.80',
          theta: '-0.02',
          providerEventAt: '2026-10-15T13:00:00.000Z',
          greekEventAt: '2026-10-15T13:00:00.000Z',
          receivedAt: '2026-10-15T13:00:05.000Z',
        }),
        instrumentKind: 'equity-option',
        underlying: 'CVX',
        occSymbol: 'ZZT   280121C00100000',
        now: new Date('2026-10-15T13:00:10.000Z'),
      });

      // Older quote/greek timestamps must not overwrite newer fields.
      const afterOlder = upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: streamer,
          bid: '1.00',
          ask: '2.00',
          mark: '1.50',
          delta: '0.10',
          theta: '-0.99',
          providerEventAt: '2026-10-15T12:00:00.000Z',
          greekEventAt: '2026-10-15T12:00:00.000Z',
          receivedAt: '2026-10-15T14:00:00.000Z',
        }),
        instrumentKind: 'equity-option',
        underlying: 'CVX',
        now: new Date('2026-10-15T14:00:00.000Z'),
      });
      expect(afterOlder.ask).toBe('10.00');
      expect(afterOlder.bid).toBe('9.00');
      expect(afterOlder.delta).toBe('0.80');
      expect(afterOlder.theta).toBe('-0.02');
      expect(afterOlder.quoteProviderEventAt).toBe('2026-10-15T13:00:00.000Z');
      expect(afterOlder.greekProviderEventAt).toBe('2026-10-15T13:00:00.000Z');

      // Newer timestamps update fields that are present.
      const afterNewer = upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: streamer,
          ask: '11.00',
          bid: '10.50',
          delta: '0.82',
          providerEventAt: '2026-10-15T13:30:00.000Z',
          greekEventAt: '2026-10-15T13:30:00.000Z',
          receivedAt: '2026-10-15T13:30:05.000Z',
        }),
        instrumentKind: 'equity-option',
        underlying: 'CVX',
        now: new Date('2026-10-15T13:30:10.000Z'),
      });
      expect(afterNewer.ask).toBe('11.00');
      expect(afterNewer.bid).toBe('10.50');
      expect(afterNewer.delta).toBe('0.82');
      // Omitted theta keeps the prior greek value when write is allowed but field is null.
      expect(afterNewer.theta).toBe('-0.02');
      expect(afterNewer.quoteProviderEventAt).toBe('2026-10-15T13:30:00.000Z');
    } finally {
      opened.close();
    }
  });

  it('never stores receipt time as quoteProviderEventAt', () => {
    const opened = tempDb();
    try {
      const receivedAt = '2026-10-15T14:00:00.000Z';
      const row = upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: '.QCOM280121C80',
          ask: '5.00',
          bid: '4.80',
          providerEventAt: null,
          greekEventAt: null,
          receivedAt,
        }),
        instrumentKind: 'equity-option',
        underlying: 'QCOM',
        now: new Date(receivedAt),
      });
      expect(row.quoteProviderEventAt).toBeNull();
      expect(row.greekProviderEventAt).toBeNull();
      expect(row.quoteReceivedAt).toBe(receivedAt);
      expect(row.quoteProviderEventAt).not.toBe(receivedAt);
    } finally {
      opened.close();
    }
  });
});

describe('mergeLiveWithCache', () => {
  it('fills missing ask and Greeks from cache with fromCache true', () => {
    const opened = tempDb();
    try {
      const streamer = '.WMT280121C90';
      upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: streamer,
          bid: '32.00',
          ask: '33.00',
          delta: '0.78',
          theta: '-0.01',
          providerEventAt: '2026-10-15T13:00:00.000Z',
          greekEventAt: '2026-10-15T13:00:00.000Z',
        }),
        instrumentKind: 'equity-option',
        underlying: 'WMT',
        now: new Date('2026-10-15T13:00:10.000Z'),
      });
      const cached = getObservationByStreamer(opened.db, streamer)!;
      const now = new Date('2026-10-15T14:00:00.000Z');
      const live = snapshot({
        streamerSymbol: streamer,
        bid: '32.10',
        ask: null,
        delta: null,
        providerEventAt: '2026-10-15T13:59:50.000Z',
        greekEventAt: null,
        receivedAt: now.toISOString(),
        sourceLabel: 'live-rest',
      });
      const merged = mergeLiveWithCache(live, cached, now)!;
      expect(merged.ask).toBe('33.00');
      expect(merged.delta).toBe('0.78');
      expect(merged.theta).toBe('-0.01');
      expect(merged.fromCache).toBe(true);
      expect(merged.sourceLabel).toMatch(/ask from last-known cache/i);
      expect(merged.sourceLabel).toMatch(/Greeks from last-known cache/i);
    } finally {
      opened.close();
    }
  });
});

describe('classifyObservationFreshness', () => {
  it('classifies current-session, previous-session, older, and unavailable', () => {
    // Thursday regular session, 10:00 AM ET
    const now = new Date('2026-10-15T14:00:00.000Z');
    expect(classifyObservationFreshness(null, now)).toBe('unavailable');
    expect(classifyObservationFreshness('not-a-date', now)).toBe('unavailable');

    expect(classifyObservationFreshness('2026-10-15T13:55:00.000Z', now)).toBe('current-session');
    // Same calendar day but older than the 15-minute current-session window
    expect(classifyObservationFreshness('2026-10-15T12:00:00.000Z', now)).toBe('previous-session');
    // Within 7 days, different NY calendar day
    expect(classifyObservationFreshness('2026-10-14T14:00:00.000Z', now)).toBe('previous-session');
    expect(classifyObservationFreshness('2026-09-01T14:00:00.000Z', now)).toBe('older');
  });
});

describe('assessGreekVerification', () => {
  it('marks aligned when timestamps are close; historical-unverified on mismatch or older greek session; unavailable without delta', () => {
    const now = new Date('2026-10-15T13:31:00.000Z'); // 9:31 AM ET Thursday

    expect(
      assessGreekVerification({
        quoteProviderEventAt: '2026-10-15T13:30:30.000Z',
        greekProviderEventAt: '2026-10-15T13:30:20.000Z',
        delta: '0.82',
        now,
      }),
    ).toBe('aligned');

    expect(
      assessGreekVerification({
        quoteProviderEventAt: '2026-10-15T13:30:30.000Z',
        greekProviderEventAt: '2026-10-15T13:20:00.000Z',
        delta: '0.82',
        now,
      }),
    ).toBe('historical-unverified');

    // Quote just after open (current-session); greek still pre-open (previous-session) within align window
    expect(
      assessGreekVerification({
        quoteProviderEventAt: '2026-10-15T13:30:30.000Z',
        greekProviderEventAt: '2026-10-15T13:29:45.000Z',
        delta: '0.82',
        now,
      }),
    ).toBe('historical-unverified');

    expect(
      assessGreekVerification({
        quoteProviderEventAt: '2026-10-15T13:30:30.000Z',
        greekProviderEventAt: '2026-10-15T13:30:20.000Z',
        delta: null,
        now,
      }),
    ).toBe('unavailable');
  });
});

describe('pruneObservations', () => {
  it('removes rows older than the retention window via updatedAt', () => {
    const opened = tempDb();
    try {
      const now = new Date('2026-10-15T14:00:00.000Z');
      upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: '.KEEP280121C40',
          ask: '1.00',
          providerEventAt: '2026-10-15T13:00:00.000Z',
        }),
        instrumentKind: 'equity-option',
        underlying: 'KEEP',
        now,
      });
      upsertObservationFromSnapshot(opened.db, {
        snapshot: snapshot({
          streamerSymbol: '.OLD280121C40',
          ask: '2.00',
          providerEventAt: '2026-09-01T13:00:00.000Z',
        }),
        instrumentKind: 'equity-option',
        underlying: 'OLD',
        now,
      });

      const staleUpdatedAt = new Date(
        now.getTime() - (OBSERVATION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
      ).toISOString();
      opened.sqlite
        .prepare('UPDATE market_data_observations SET updated_at = ? WHERE streamer_symbol = ?')
        .run(staleUpdatedAt, '.OLD280121C40');

      pruneObservations(opened.db, now);
      expect(getObservationByStreamer(opened.db, '.KEEP280121C40')).not.toBeNull();
      expect(getObservationByStreamer(opened.db, '.OLD280121C40')).toBeNull();
      const remaining = opened.db.select().from(marketDataObservations).all();
      expect(remaining).toHaveLength(1);
    } finally {
      opened.close();
    }
  });
});
