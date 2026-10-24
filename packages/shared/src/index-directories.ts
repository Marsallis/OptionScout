/**
 * Explore Stocks directories that are present without a holdings import.
 * An imported fund file can still replace one of these lists.
 */

import { NASDAQ100_ROWS, SP500_ROWS, VTI_ROWS } from './index-directories.data.js';
import { discoveryUniverseSchema, type DiscoveryUniverse } from './smart-scan.js';

const AS_OF = '2026-10-24T00:00:00.000Z';

function snapshot(input: {
  id: string;
  name: string;
  sourceLabel: string;
  rows: ReadonlyArray<readonly [string, string, string]>;
}): DiscoveryUniverse {
  const companyNames: Record<string, string> = {};
  const sectors: Record<string, string> = {};
  const tickers: string[] = [];
  for (const [ticker, name, sector] of input.rows) {
    tickers.push(ticker);
    companyNames[ticker] = name;
    if (sector) sectors[ticker] = sector;
  }
  return discoveryUniverseSchema.parse({
    id: input.id,
    name: input.name,
    sourceKind: 'curated-starter',
    sourceLabel: input.sourceLabel,
    retrievedAt: '2026-10-24',
    tickers,
    companyNames,
    sectors,
    editable: false,
    createdAt: AS_OF,
    updatedAt: AS_OF,
    currentVersion: null,
  });
}

export const INDEX_DIRECTORY_UNIVERSES = {
  sp500: snapshot({
    id: 'index-sp500',
    name: 'S&P 500',
    sourceLabel: 'Research snapshot of S&P 500 companies retrieved 2026-10-24. Not a licensed index membership feed.',
    rows: SP500_ROWS,
  }),
  nasdaq100: snapshot({
    id: 'index-nasdaq100',
    name: 'Nasdaq-100',
    sourceLabel: 'Research snapshot of Nasdaq-100 companies retrieved 2026-10-24. Not Invesco’s QQQ holdings file.',
    rows: NASDAQ100_ROWS,
  }),
  vti: snapshot({
    id: 'index-vti',
    name: 'VTI',
    sourceLabel: 'Research snapshot of VTI equity holdings as of 2026-08-31. Cash, warrants, and rows without a ticker are omitted. Not Vanguard’s file.',
    rows: VTI_ROWS,
  }),
} as const;

export const INDEX_DIRECTORY_LIST: readonly DiscoveryUniverse[] = [
  INDEX_DIRECTORY_UNIVERSES.sp500,
  INDEX_DIRECTORY_UNIVERSES.nasdaq100,
  INDEX_DIRECTORY_UNIVERSES.vti,
];
