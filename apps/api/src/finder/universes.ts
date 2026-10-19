import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  discoveryUniverseSchema,
  listCuratedStarterUniverses,
  normalizeTickerList,
  parseTickerCsv,
  type DiscoveryUniverse,
} from '@optionscout/shared';
import type { AppDatabase } from '../db/client.js';
import { discoveryUniverses, discoveryUniverseVersions, finderBookmarks } from '../db/schema.js';

type UniverseRow = typeof discoveryUniverses.$inferSelect;
type VersionRow = typeof discoveryUniverseVersions.$inferSelect;
type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function versionInfo(row: VersionRow | undefined): DiscoveryUniverse['currentVersion'] {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    universeType: row.universeType,
    provider: row.provider,
    sourceLabel: row.sourceLabel,
    fundTicker: row.fundTicker ?? null,
    holdingsEffectiveDate: row.holdingsEffectiveDate ?? null,
    importedAt: row.importedAt,
    rowCount: row.rowCount,
    supportedEquityCount: row.supportedEquityCount,
    unsupportedCount: Math.max(0, row.rowCount - row.supportedEquityCount),
  };
}

function rowToUniverse(row: UniverseRow, version: VersionRow | undefined): DiscoveryUniverse {
  return discoveryUniverseSchema.parse({
    id: row.id,
    name: row.name,
    sourceKind: row.sourceKind,
    sourceLabel: row.sourceLabel,
    retrievedAt: row.retrievedAt,
    tickers: JSON.parse(row.tickersJson) as string[],
    companyNames: JSON.parse(row.companyNamesJson || '{}') as Record<string, string>,
    sectors: JSON.parse(version?.sectorsJson || row.sectorsJson || '{}') as Record<string, string>,
    weights: JSON.parse(version?.weightsJson || row.weightsJson || '{}') as Record<string, string>,
    weightReading: (version?.weightReading || row.weightReading || 'unspecified') as DiscoveryUniverse['weightReading'],
    weightPercents: JSON.parse(version?.weightPercentsJson || row.weightPercentsJson || '{}') as Record<string, string>,
    editable: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    currentVersion: versionInfo(version),
  });
}

function getVersionRow(db: AppDatabase | Tx, versionId: string | null | undefined): VersionRow | undefined {
  if (!versionId) return undefined;
  return db.select().from(discoveryUniverseVersions).where(eq(discoveryUniverseVersions.id, versionId)).get();
}

export function listSavedUniverses(db: AppDatabase): DiscoveryUniverse[] {
  const versions = new Map(db.select().from(discoveryUniverseVersions).all().map((row) => [row.id, row]));
  return db
    .select()
    .from(discoveryUniverses)
    .all()
    .map((row) => rowToUniverse(row, row.currentVersionId ? versions.get(row.currentVersionId) : undefined))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listAllUniverses(db: AppDatabase): {
  curated: DiscoveryUniverse[];
  saved: DiscoveryUniverse[];
  bookmarkDerived: DiscoveryUniverse | null;
} {
  const bookmarks = db.select().from(finderBookmarks).all();
  const fromBookmarks = normalizeTickerList(bookmarks.map((row) => row.underlying)).tickers;
  const bookmarkDerived =
    fromBookmarks.length === 0
      ? null
      : discoveryUniverseSchema.parse({
          id: 'bookmark-derived',
          name: 'From saved Finder candidates',
          sourceKind: 'bookmark-derived',
          sourceLabel:
            'Distinct underlyings from local Finder bookmarks. Not a brokerage watchlist. Useful for re-checking names you already saved.',
          retrievedAt: nowIso().slice(0, 10),
          tickers: fromBookmarks,
          companyNames: {},
          editable: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });

  return {
    curated: listCuratedStarterUniverses(),
    saved: listSavedUniverses(db),
    bookmarkDerived,
  };
}

export type NewVersionInput = {
  universeType: string;
  provider: string;
  sourceLabel: string;
  fundTicker: string | null;
  holdingsEffectiveDate: string | null;
  rowCount: number;
  tickers: string[];
  companyNames: Record<string, string>;
  sectors?: Record<string, string>;
  weights?: Record<string, string>;
  weightReading?: DiscoveryUniverse['weightReading'];
  weightPercents?: Record<string, string>;
  unsupported: unknown[];
  holdingsHash: string | null;
};

/** Insert the next immutable version (max + 1) and point the universe at it. Call inside a transaction. */
function insertNextVersion(tx: Tx, universe: UniverseRow, input: NewVersionInput, now: string): VersionRow {
  const latest = tx
    .select()
    .from(discoveryUniverseVersions)
    .where(eq(discoveryUniverseVersions.universeId, universe.id))
    .all()
    .reduce((max, row) => Math.max(max, row.version), 0);
  const version = latest + 1;
  const id = `${universe.id}@v${version}`;
  tx.insert(discoveryUniverseVersions)
    .values({
      id,
      universeId: universe.id,
      version,
      name: universe.name,
      universeType: input.universeType,
      fundTicker: input.fundTicker,
      provider: input.provider,
      sourceLabel: input.sourceLabel,
      holdingsEffectiveDate: input.holdingsEffectiveDate,
      importedAt: now,
      rowCount: input.rowCount,
      supportedEquityCount: input.tickers.length,
      unsupportedJson: JSON.stringify(input.unsupported),
      tickersJson: JSON.stringify(input.tickers),
      companyNamesJson: JSON.stringify(input.companyNames),
      sectorsJson: JSON.stringify(input.sectors ?? {}),
      weightsJson: JSON.stringify(input.weights ?? {}),
      weightReading: input.weightReading ?? 'unspecified',
      weightPercentsJson: JSON.stringify(input.weightPercents ?? {}),
      holdingsHash: input.holdingsHash,
      createdAt: now,
    })
    .run();
  tx.update(discoveryUniverses)
    .set({
      tickersJson: JSON.stringify(input.tickers),
      companyNamesJson: JSON.stringify(input.companyNames),
      sectorsJson: JSON.stringify(input.sectors ?? {}),
      weightsJson: JSON.stringify(input.weights ?? {}),
      weightReading: input.weightReading ?? 'unspecified',
      weightPercentsJson: JSON.stringify(input.weightPercents ?? {}),
      sourceLabel: input.sourceLabel,
      retrievedAt: (input.holdingsEffectiveDate ?? now).slice(0, 10),
      currentVersionId: id,
      fundTicker: input.fundTicker,
      universeType: input.universeType,
      updatedAt: now,
    })
    .where(eq(discoveryUniverses.id, universe.id))
    .run();
  return tx.select().from(discoveryUniverseVersions).where(eq(discoveryUniverseVersions.id, id)).get()!;
}

function newUniverseId(now: string): string {
  return `univ_${now.replace(/[:.]/g, '')}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Create a universe row and its v1 version atomically. */
export function createUniverseWithVersion(
  db: AppDatabase,
  input: { name: string; sourceKind: 'custom' | 'csv-import' | 'manual-paste' } & NewVersionInput,
): { universe: DiscoveryUniverse; version: VersionRow } {
  const now = nowIso();
  const id = newUniverseId(now);
  return db.transaction((tx) => {
    tx.insert(discoveryUniverses)
      .values({
        id,
        name: input.name.trim(),
        sourceKind: input.sourceKind,
        sourceLabel: input.sourceLabel,
        retrievedAt: now.slice(0, 10),
        tickersJson: JSON.stringify(input.tickers),
        companyNamesJson: JSON.stringify(input.companyNames),
        sectorsJson: JSON.stringify(input.sectors ?? {}),
        weightsJson: JSON.stringify(input.weights ?? {}),
        weightReading: input.weightReading ?? 'unspecified',
        weightPercentsJson: JSON.stringify(input.weightPercents ?? {}),
        createdAt: now,
        updatedAt: now,
        universeType: input.universeType,
        fundTicker: input.fundTicker,
      })
      .run();
    const created = tx.select().from(discoveryUniverses).where(eq(discoveryUniverses.id, id)).get()!;
    const version = insertNextVersion(tx, created, input, now);
    const refreshed = tx.select().from(discoveryUniverses).where(eq(discoveryUniverses.id, id)).get()!;
    return { universe: rowToUniverse(refreshed, version), version };
  });
}

/** Append a new immutable version to an existing saved universe. */
export function appendUniverseVersion(
  db: AppDatabase,
  universeId: string,
  input: NewVersionInput,
): { universe: DiscoveryUniverse; version: VersionRow; unchanged: boolean } {
  const now = nowIso();
  return db.transaction((tx) => {
    const existing = tx.select().from(discoveryUniverses).where(eq(discoveryUniverses.id, universeId)).get();
    if (!existing) throw new UniverseError('That saved collection was not found.', 404);
    const current = getVersionRow(tx, existing.currentVersionId);
    if (current && input.holdingsHash && current.holdingsHash === input.holdingsHash) {
      return { universe: rowToUniverse(existing, current), version: current, unchanged: true };
    }
    const version = insertNextVersion(tx, existing, input, now);
    const refreshed = tx.select().from(discoveryUniverses).where(eq(discoveryUniverses.id, universeId)).get()!;
    return { universe: rowToUniverse(refreshed, version), version, unchanged: false };
  });
}

export class UniverseError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export function createUniverse(
  db: AppDatabase,
  input: { name: string; tickers: string[]; sourceKind?: 'custom' | 'csv-import' | 'manual-paste'; sourceLabel?: string },
): DiscoveryUniverse {
  const { tickers, rejected } = normalizeTickerList(input.tickers);
  if (tickers.length === 0) {
    throw new UniverseError(
      rejected.length > 0
        ? `No valid tickers after validation. Rejected: ${rejected.slice(0, 5).join(', ')}`
        : 'Provide at least one ticker.',
    );
  }
  const now = nowIso();
  const sourceKind = input.sourceKind ?? 'custom';
  const sourceLabel =
    input.sourceLabel ??
    (sourceKind === 'csv-import'
      ? `Owner CSV import on ${now.slice(0, 10)}`
      : `Owner custom list updated ${now.slice(0, 10)}`);
  return createUniverseWithVersion(db, {
    name: input.name,
    sourceKind,
    universeType: 'custom',
    provider: 'Owner',
    sourceLabel,
    fundTicker: null,
    holdingsEffectiveDate: null,
    rowCount: tickers.length + rejected.length,
    tickers,
    companyNames: {},
    unsupported: rejected.map((raw) => ({ rawTicker: raw, status: 'invalid' })),
    holdingsHash: null,
  }).universe;
}

export function createUniverseFromCsv(db: AppDatabase, name: string, csvText: string): DiscoveryUniverse {
  const { tickers, rejected } = parseTickerCsv(csvText);
  if (tickers.length === 0) {
    throw new UniverseError(
      rejected.length > 0
        ? `CSV produced no valid tickers. Rejected examples: ${rejected.slice(0, 5).join(', ')}`
        : 'CSV contained no ticker symbols.',
    );
  }
  return createUniverse(db, {
    name,
    tickers,
    sourceKind: 'csv-import',
    sourceLabel: `Owner CSV import on ${nowIso().slice(0, 10)}${rejected.length ? ` (${rejected.length} rejected rows)` : ''}`,
  });
}

/**
 * Remove the saved collection from the library. Immutable version rows are kept so historical
 * research sessions still show the membership they were run against.
 */
export function deleteUniverse(db: AppDatabase, id: string): boolean {
  if (id.startsWith('curated-') || id === 'bookmark-derived') return false;
  const existing = db.select().from(discoveryUniverses).where(eq(discoveryUniverses.id, id)).all();
  if (existing.length === 0) return false;
  db.delete(discoveryUniverses).where(eq(discoveryUniverses.id, id)).run();
  return true;
}

export type ResolvedScanUniverse = {
  universeId: string | null;
  universeVersionId: string | null;
  label: string;
  /** Full stable membership order of the pinned version. */
  tickers: string[];
  companyNames: Record<string, string>;
};

/**
 * Resolve the immutable membership a new session pins. Saved collections resolve to their
 * current (or explicitly requested) version row; curated and bookmark lists get a content-derived
 * version id so the session records exactly what it was given.
 */
export function resolveScanUniverse(
  db: AppDatabase,
  input: { universeId?: string | null; universeVersionId?: string | null },
): ResolvedScanUniverse {
  const universeId = input.universeId ?? null;
  const requestedVersion = input.universeVersionId ?? null;

  if (requestedVersion && !requestedVersion.startsWith('curated:') && !requestedVersion.startsWith('bookmark-derived@')) {
    const version = getVersionRow(db, requestedVersion);
    if (!version) throw new UniverseError('That collection version was not found.', 404);
    if (universeId && version.universeId !== universeId) {
      throw new UniverseError('That version does not belong to the selected collection.');
    }
    return {
      universeId: version.universeId,
      universeVersionId: version.id,
      label: `${version.name} (v${version.version})`,
      tickers: JSON.parse(version.tickersJson) as string[],
      companyNames: JSON.parse(version.companyNamesJson || '{}') as Record<string, string>,
    };
  }

  if (!universeId) throw new UniverseError('Select a stock collection or provide tickers.');

  const curated = listCuratedStarterUniverses().find((row) => row.id === universeId);
  if (curated) {
    const versionId = `curated:${curated.id}@${curated.retrievedAt}`;
    if (requestedVersion && requestedVersion !== versionId) {
      throw new UniverseError('That starter list version is no longer available. Choose the current list.', 409);
    }
    return {
      universeId: curated.id,
      universeVersionId: versionId,
      label: curated.name,
      tickers: curated.tickers,
      companyNames: curated.companyNames,
    };
  }

  if (universeId === 'bookmark-derived') {
    const derived = listAllUniverses(db).bookmarkDerived;
    if (!derived) throw new UniverseError('No bookmark-derived tickers are available yet.');
    return {
      universeId: derived.id,
      universeVersionId: `bookmark-derived@${sha256Hex(derived.tickers.join(',')).slice(0, 12)}`,
      label: derived.name,
      tickers: derived.tickers,
      companyNames: {},
    };
  }

  const row = db.select().from(discoveryUniverses).where(eq(discoveryUniverses.id, universeId)).get();
  if (!row) throw new UniverseError('That saved collection was not found.', 404);
  const version = getVersionRow(db, row.currentVersionId);
  if (!version) {
    throw new UniverseError('This saved collection has no recorded version. Re-import it before scanning.', 409);
  }
  return {
    universeId: row.id,
    universeVersionId: version.id,
    label: `${row.name} (v${version.version})`,
    tickers: JSON.parse(version.tickersJson) as string[],
    companyNames: JSON.parse(version.companyNamesJson || '{}') as Record<string, string>,
  };
}

/** Legacy helper retained for callers that only need a flat ticker list. */
export function resolveUniverseTickers(
  db: AppDatabase,
  universeId: string | null | undefined,
  manualTickers?: string[],
): { tickers: string[]; label: string; companyNames: Record<string, string> } {
  if (manualTickers && manualTickers.length > 0) {
    const { tickers } = normalizeTickerList(manualTickers);
    return { tickers, label: `Manual selection (${tickers.length} companies)`, companyNames: {} };
  }
  const resolved = resolveScanUniverse(db, { universeId });
  return { tickers: resolved.tickers, label: resolved.label, companyNames: resolved.companyNames };
}
