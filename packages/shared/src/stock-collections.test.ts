import { describe, expect, it } from 'vitest';
import {
  STOCK_COLLECTION_CATALOG,
  collectionDisplayName,
  collectionIsReady,
  installedHoldingsForFund,
  rankCompanyMatches,
  topHoldingsByWeight,
} from './stock-collections.js';
import { listCuratedStarterUniverses, type DiscoveryUniverse } from './smart-scan.js';

function savedFund(fund: string, count: number): DiscoveryUniverse {
  return {
    id: `univ-${fund}`,
    name: `${fund} holdings`,
    sourceKind: 'csv-import',
    sourceLabel: 'Owner import',
    retrievedAt: '2026-10-15',
    tickers: Array.from({ length: count }, (_, index) => `T${index}`),
    companyNames: {},
    sectors: {},
    weights: {},
    editable: true,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    currentVersion: {
      id: `univ-${fund}@v1`,
      version: 1,
      universeType: 'etf_holdings',
      provider: 'Provider',
      sourceLabel: 'Owner import',
      fundTicker: fund,
      holdingsEffectiveDate: '2026-10-15',
      importedAt: '2026-10-18T00:00:00.000Z',
      rowCount: count,
      supportedEquityCount: count,
      unsupportedCount: 0,
    },
  };
}

describe('stock collection catalog', () => {
  it('names familiar collections and does not treat the catalog itself as scan-ready', () => {
    const titles = STOCK_COLLECTION_CATALOG.map((row) => row.title);
    expect(titles).toEqual([
      'S&P 500 exposure',
      'Total U.S. market',
      'Nasdaq-100 exposure',
      'Smaller companies',
      'Sector ETF collections',
    ]);
    expect(STOCK_COLLECTION_CATALOG.every((row) => row.funds.length > 0)).toBe(true);
    expect(STOCK_COLLECTION_CATALOG.flatMap((row) => row.funds).every((fund) => fund.holdingsPageUrl.startsWith('https://'))).toBe(true);
    expect(collectionIsReady(null)).toBe(false);
    expect(installedHoldingsForFund([], 'VTI')).toBeNull();
  });

  it('matches an imported fund and ignores a curated example list', () => {
    const vti = savedFund('VTI', 3200);
    const starters = listCuratedStarterUniverses();
    expect(installedHoldingsForFund([vti, ...starters], 'vti')?.id).toBe('univ-VTI');
    expect(installedHoldingsForFund(starters, 'SPY')).toBeNull();
    expect(collectionIsReady(vti)).toBe(true);
    expect(collectionIsReady({ tickers: [] })).toBe(false);
  });

  it('drops the duplicated Explore prefix and ranks only recorded weights', () => {
    expect(collectionDisplayName('Explore: Energy & retail examples')).toBe('Energy & retail examples');
    expect(collectionDisplayName('VTI holdings')).toBe('VTI holdings');
    expect(topHoldingsByWeight(['A', 'B', 'C', 'D'], { A: '1.5', C: '9', B: '3' }, 2)).toEqual(['C', 'B']);
    expect(topHoldingsByWeight(['A', 'B', 'C'], { A: '7.1', B: '7.1', C: '0.071' }, 3)).toEqual(['A', 'B', 'C']);
    expect(topHoldingsByWeight(['A', 'B'], {}, 12)).toEqual([]);
  });

  it('still finds an exact ticker at the end of a long collection when suggestions are capped', () => {
    const options = Array.from({ length: 3200 }, (_, index) => ({
      ticker: index === 3199 ? 'ZZEND' : `T${index}`,
      name: index < 40 ? 'Alpha company' : `Company ${index}`,
    }));
    const inCollection = rankCompanyMatches(options, 'ZZEND', 30);
    expect(inCollection.map((row) => row.ticker)).toContain('ZZEND');
    expect(inCollection[0]?.ticker).toBe('ZZEND');
    const across = rankCompanyMatches(options, 'ZZEND', 8);
    expect(across).toEqual([{ ticker: 'ZZEND', name: 'Company 3199' }]);
    const partial = rankCompanyMatches(options, 'Alpha', 8);
    expect(partial).toHaveLength(8);
    expect(partial.every((row) => row.name.startsWith('Alpha'))).toBe(true);
  });
});
