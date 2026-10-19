import {
  previewHoldingsCsv,
  type HoldingsMappableRole,
  type HoldingsPreview,
} from '@optionscout/shared';
import type { AppDatabase } from '../db/client.js';
import { UniverseError, appendUniverseVersion, createUniverseWithVersion, sha256Hex } from './universes.js';

export type HoldingsMapping = Partial<Record<HoldingsMappableRole, string>>;

export function previewHoldingsImport(
  csvText: string,
  mapping: HoldingsMapping = {},
  weightChoice: 'auto' | 'percentage-points' | 'decimal-fraction' = 'auto',
): HoldingsPreview {
  return previewHoldingsCsv(csvText, mapping, sha256Hex, weightChoice);
}

/**
 * Save previewed holdings as a new immutable version. The caller must present the content hash
 * returned by preview so only the exact validated file (with the same mapping) is stored.
 * Creating the universe and its version happens in a single transaction.
 */
export function commitHoldingsImport(
  db: AppDatabase,
  input: {
    name: string;
    universeId?: string | null;
    fundTicker?: string | null;
    provider: string;
    holdingsEffectiveDate: string;
    csvText: string;
    mapping?: HoldingsMapping;
    contentHash: string;
    weightChoice?: 'auto' | 'percentage-points' | 'decimal-fraction';
  },
): { universeId: string; versionId: string; version: number; unchanged: boolean; preview: HoldingsPreview } {
  const preview = previewHoldingsImport(input.csvText, input.mapping ?? {}, input.weightChoice ?? 'auto');
  if (!input.contentHash || preview.contentHash !== input.contentHash) {
    throw new UniverseError('Preview the file again before saving: the content changed since it was validated.', 409);
  }
  if (preview.truncated) {
    throw new UniverseError('This file has more rows than the import limit. Split it before saving.');
  }
  if (preview.uniqueEquityTickers.length === 0) {
    throw new UniverseError('No stock holdings remained after validation, so nothing was saved.');
  }
  const fundTicker = input.fundTicker?.trim().toUpperCase() || null;
  const sourceLabel = `${input.provider} holdings${fundTicker ? ` for ${fundTicker}` : ''} as of ${input.holdingsEffectiveDate}`;
  const versionInput = {
    universeType: 'etf_holdings',
    provider: input.provider,
    sourceLabel,
    fundTicker,
    holdingsEffectiveDate: input.holdingsEffectiveDate,
    rowCount: preview.counts.parsed,
    tickers: preview.uniqueEquityTickers,
    companyNames: preview.companyNames,
    sectors: preview.sectors,
    weights: preview.weights,
    weightPercents: preview.weightPercents,
    weightReading: preview.weightReading,
    unsupported: preview.rows
      .filter((row) => row.status !== 'equity')
      .slice(0, 500)
      .map((row) => ({ line: row.line, rawTicker: row.rawTicker, status: row.status, reason: row.reason })),
    holdingsHash: preview.contentHash,
  };
  if (input.universeId) {
    const appended = appendUniverseVersion(db, input.universeId, versionInput);
    return {
      universeId: appended.universe.id,
      versionId: appended.version.id,
      version: appended.version.version,
      unchanged: appended.unchanged,
      preview,
    };
  }
  const created = createUniverseWithVersion(db, { name: input.name, sourceKind: 'csv-import', ...versionInput });
  return {
    universeId: created.universe.id,
    versionId: created.version.id,
    version: created.version.version,
    unchanged: false,
    preview,
  };
}
