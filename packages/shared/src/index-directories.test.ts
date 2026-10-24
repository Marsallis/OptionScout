import { describe, expect, it } from 'vitest';
import { INDEX_DIRECTORY_UNIVERSES } from './index-directories.js';
import { validateTickerSymbol } from './smart-scan.js';

describe('bundled explore directories', () => {
  it('loads S&P 500, Nasdaq-100, and VTI without an import', () => {
    const sp = INDEX_DIRECTORY_UNIVERSES.sp500;
    const nasdaq = INDEX_DIRECTORY_UNIVERSES.nasdaq100;
    const vti = INDEX_DIRECTORY_UNIVERSES.vti;

    expect(sp.tickers.length).toBeGreaterThanOrEqual(500);
    expect(nasdaq.tickers.length).toBeGreaterThanOrEqual(100);
    expect(vti.tickers.length).toBeGreaterThan(3000);

    expect(sp.tickers).toContain('AAPL');
    expect(sp.companyNames.AAPL).toMatch(/Apple/i);
    expect(nasdaq.tickers).toContain('NVDA');
    expect(nasdaq.companyNames.NVDA).toMatch(/Nvidia/i);
    expect(vti.tickers).toContain('AAPL');
    expect(vti.companyNames.MSFT).toMatch(/Microsoft/i);

    for (const universe of [sp, nasdaq, vti]) {
      expect(new Set(universe.tickers).size).toBe(universe.tickers.length);
      expect(universe.tickers.every((ticker) => validateTickerSymbol(ticker).ok)).toBe(true);
      expect(universe.editable).toBe(false);
    }
  });
});
