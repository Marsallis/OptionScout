import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAL_PMCC_DEEP_ITM, type FinderCandidate } from '@optionscout/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { setupOwnerPassphrase } from '../auth/owner.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { listFinderBookmarks, saveFinderBookmark } from './bookmarks.js';
import { resetFinderScans, runFinderScanForTest } from './scan.js';

const contexts: AppContext[] = [];
const directories: string[] = [];
const passphrase = 'correct horse battery staple';

afterEach(() => {
  resetFinderScans();
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function opened(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-bookmarks-'));
  directories.push(directory);
  const context = await openAppContext(
    parseConfig(
      {
        NODE_ENV: 'test',
        PORT: '3180',
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: path.join(directory, 'optionscout.sqlite'),
        DATA_MODE: 'demo',
        AUTH_MODE: 'local-owner',
        ENABLE_ORDER_EXECUTION: 'false',
        TELEMETRY_ENABLED: 'false',
        RUNNING_IN_DOCKER: 'false',
        STATIC_DIR: '',
        FINDER_LIVE_SCAN: 'false',
      },
      { secretFilePath: path.join(directory, 'missing.env') },
    ),
  );
  contexts.push(context);
  return context;
}

function insertBookmark(
  context: AppContext,
  row: {
    id: string;
    underlying: string;
    occSymbol: string;
    savedAt: string;
    snapshotJson: string;
    profileId?: string | null;
    profileRevision?: number | null;
    scanId?: string | null;
    quoteAsOf?: string | null;
  },
): void {
  context.database.sqlite
    .prepare(
      `INSERT INTO finder_bookmarks (
        id, underlying, occ_symbol, streamer_symbol, saved_at, snapshot_json, profile_id, profile_revision, scan_id, quote_as_of
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.underlying,
      row.occSymbol,
      row.savedAt,
      row.snapshotJson,
      row.profileId ?? null,
      row.profileRevision ?? null,
      row.scanId ?? null,
      row.quoteAsOf ?? null,
    );
}

describe('finder bookmark compatibility', () => {
  it('loads current, legacy, incomplete, and malformed rows without failing the list', async () => {
    const context = await opened();
    const result = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 4 },
    );
    const source = result.candidates.find((row) => row.supportStatus === 'supported' && row.ask != null)!;
    const current = saveFinderBookmark(context.database.db, source, '2026-10-17T21:00:00.000Z', {
      profileId: 'sal-pmcc-deep-itm',
      profileRevision: 2,
      scanId: 'demo-current-scan',
    });

    const legacySnapshot = structuredClone(source) as FinderCandidate;
    delete legacySnapshot.observationFreshness;
    delete legacySnapshot.greekVerification;
    delete legacySnapshot.greekProviderEventAt;
    delete legacySnapshot.validationIssues;
    delete legacySnapshot.flags.unverifiedGreeks;
    delete legacySnapshot.flags.fromCache;
    const legacyJson = JSON.stringify(legacySnapshot);
    insertBookmark(context, {
      id: 'bm_legacy',
      underlying: source.underlying,
      occSymbol: source.occSymbol,
      savedAt: '2026-10-16T18:28:17.154Z',
      snapshotJson: legacyJson,
      profileId: 'sal-pmcc-deep-itm',
      profileRevision: 1,
      scanId: 'fixture-legacy-scan',
      quoteAsOf: source.providerEventAt,
    });
    insertBookmark(context, {
      id: 'bm_incomplete',
      underlying: 'DEMO',
      occSymbol: 'DEMO  280121C00040000',
      savedAt: '2026-10-15T12:00:00.000Z',
      snapshotJson: JSON.stringify({ id: 'partial-only' }),
      profileId: 'sal-pmcc-deep-itm',
      profileRevision: 1,
      scanId: 'incomplete-scan',
      quoteAsOf: null,
    });
    insertBookmark(context, {
      id: 'bm_malformed',
      underlying: 'DEMO',
      occSymbol: 'DEMO  280121C00045000',
      savedAt: '2026-10-14T12:00:00.000Z',
      snapshotJson: '{',
      profileId: null,
      profileRevision: null,
      scanId: null,
      quoteAsOf: null,
    });

    const listed = listFinderBookmarks(context.database.db);
    expect(listed.bookmarks.map((row) => row.id)).toEqual([current.id, 'bm_legacy']);
    const legacy = listed.bookmarks.find((row) => row.id === 'bm_legacy')!;
    expect(legacy.snapshot.strike).toBe(source.strike);
    expect(legacy.snapshot.delta).toBe(source.delta);
    expect(legacy.snapshot.bid).toBe(source.bid);
    expect(legacy.snapshot.ask).toBe(source.ask);
    expect(legacy.snapshot.calculations.estimatedPurchaseCost).toBe(source.calculations.estimatedPurchaseCost);
    expect(legacy.snapshot.observationFreshness).toBe('unavailable');
    expect(legacy.snapshot.greekVerification).toBe('unavailable');
    expect(legacy.snapshot.greekProviderEventAt).toBeNull();
    expect(legacy.snapshot.flags.unverifiedGreeks).toBeNull();
    expect(legacy.snapshot.flags.fromCache).toBeNull();
    expect(legacy.profileId).toBe('sal-pmcc-deep-itm');
    expect(legacy.profileRevision).toBe(1);
    expect(legacy.scanId).toBe('fixture-legacy-scan');
    expect(legacy.quoteAsOf).toBe(source.providerEventAt);
    expect(listed.bookmarks.find((row) => row.id === current.id)?.snapshot.flags.fromCache).toBe(source.flags.fromCache);

    const reconstructed = listed.warnings.find((row) => row.id === 'bm_legacy')!;
    expect(reconstructed.code).toBe('legacy-reconstructed');
    expect(reconstructed.missingFields).toEqual(
      expect.arrayContaining([
        'observationFreshness',
        'greekVerification',
        'greekProviderEventAt',
        'validationIssues',
        'flags.unverifiedGreeks',
        'flags.fromCache',
      ]),
    );
    expect(reconstructed.message).toMatch(/unavailable/i);
    expect(reconstructed.message).toMatch(/Nothing was estimated/);
    expect(reconstructed.message).not.toContain(source.strike);
    expect(listed.warnings.find((row) => row.id === 'bm_incomplete')?.code).toBe('unreadable');
    expect(listed.warnings.find((row) => row.id === 'bm_malformed')?.code).toBe('unreadable');
    expect(listed.warnings.some((row) => row.id === current.id)).toBe(false);

    const storedLegacy = context.database.sqlite.prepare('SELECT snapshot_json FROM finder_bookmarks WHERE id = ?').get('bm_legacy') as {
      snapshot_json: string;
    };
    expect(storedLegacy.snapshot_json).toBe(legacyJson);

    setupOwnerPassphrase(context.database.db, passphrase);
    const app = createApp(context);
    expect((await request(app).get('/api/finder/bookmarks')).status).toBe(401);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase });
    const httpList = await agent.get('/api/finder/bookmarks').set('Origin', 'http://127.0.0.1');
    expect(loggedIn.status).toBe(200);
    expect(httpList.status).toBe(200);
    expect(httpList.body.bookmarks).toHaveLength(2);
    expect(httpList.body.warnings).toHaveLength(3);
    expect(httpList.body.warnings.map((row: { code: string }) => row.code).sort()).toEqual([
      'legacy-reconstructed',
      'unreadable',
      'unreadable',
    ]);
  });
});
