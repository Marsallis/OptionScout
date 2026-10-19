import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HoldingsPreviewError, interpretHoldingsWeights, previewHoldingsCsv } from './holdings-csv.js';
import { normalizeTickerList, validateTickerSymbol } from './smart-scan.js';

const SAMPLE = `Fund Holdings
Ticker,Name,Sector,Weight (%),Asset Class
AAPL,Apple Inc,Information Technology,7.1,Equity
MSFT,Microsoft,Information Technology,6.2,Equity
AAPL,Apple Inc,Information Technology,0.1,Equity
CASH_USD,US Dollar,Cash,1.2,Cash
BRK.B,Berkshire,Financials,1.8,Equity
!!!,Bad,Unknown,0,Equity
`;

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('previewHoldingsCsv', () => {
  it('maps columns, dedupes equities, and separates cash/invalid rows', () => {
    const preview = previewHoldingsCsv(SAMPLE);
    expect(preview.uniqueEquityTickers).toEqual(['AAPL', 'MSFT', 'BRK.B']);
    expect(preview.counts.duplicate).toBe(1);
    expect(preview.counts.cash).toBe(1);
    expect(preview.counts.invalid).toBe(1);
    expect(preview.companyNames.AAPL).toContain('Apple');
  });

  it('returns row-level results with line numbers and reasons', () => {
    const preview = previewHoldingsCsv(SAMPLE);
    const bad = preview.rows.find((row) => row.rawTicker === '!!!');
    expect(bad).toMatchObject({ status: 'invalid', line: 8 });
    expect(bad?.reason).toMatch(/Invalid ticker/);
    const dup = preview.rows.filter((row) => row.status === 'duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.line).toBe(5);
  });

  it('detects provider preamble dates, footers, and normalized share classes', () => {
    const csv = `iShares Core S&P 500 ETF
Fund Holdings as of,"Oct 15, 2026"
Ticker,Name,Sector,Asset Class,Weight (%)
BRK-B,Berkshire Hathaway Inc Class B,Financials,Equity,1.6
XYZ1,Bad Symbol Co,Industrials,Equity,0.1
ESU6,S&P500 EMINI DEC 26,Cash and/or Derivatives,Futures,0.2
"The content contained herein is owned or licensed by BlackRock"
`;
    const preview = previewHoldingsCsv(csv);
    expect(preview.detectedEffectiveDate).toBe('2026-10-15');
    expect(preview.uniqueEquityTickers).toEqual(['BRK.B']);
    expect(preview.counts.normalizedShareClass).toBe(1);
    expect(preview.rows.find((r) => r.rawTicker === 'BRK-B')?.reason).toMatch(/normalized from BRK-B/);
    expect(preview.rows.find((r) => r.rawTicker === 'XYZ1')?.status).toBe('invalid');
    expect(preview.rows.find((r) => r.rawTicker === 'ESU6')?.status).toBe('non-equity');
    expect(preview.counts.ignored).toBe(1);
  });

  it('honours manual column mapping and rejects unknown mapped columns', () => {
    const csv = `Code,Security,Pct
AAPL,Apple,7
MSFT,Microsoft,6
`;
    expect(() => previewHoldingsCsv(csv)).toThrow(HoldingsPreviewError);
    const mapped = previewHoldingsCsv(csv, { ticker: 'Code', name: 'Security', weight: 'Pct' });
    expect(mapped.uniqueEquityTickers).toEqual(['AAPL', 'MSFT']);
    expect(mapped.mapping).toMatchObject({ Code: 'ticker', Security: 'name', Pct: 'weight' });
    expect(() => previewHoldingsCsv(csv, { ticker: 'Nope' })).toThrow(/not found/);
  });

  it('reports a content hash of the exact previewed text', () => {
    const preview = previewHoldingsCsv(SAMPLE, {}, sha);
    expect(preview.contentHash).toBe(sha(SAMPLE));
  });

  it('keeps percent and decimal weights as written, and rejects a file past the row cap', () => {
    const csv = `Holdings as of 2026-03-31
Symbol,Security Name,GICS Sector,% of Net Assets,Asset Class
AAPL,Apple Inc,Information Technology,7.10%,Equity
MSFT,Microsoft Corp,Information Technology,0.062,Equity
BRK/B,Berkshire Hathaway Class B,Financials,1.6%,Equity
GOOG,Alphabet Class C,Communication Services,2%,Equity
USD,,Cash and/or Derivatives,0.4%,Cash
DUPE,Apple Inc,Information Technology,0.01%,Equity
"Source: provider website. Not for redistribution."
`;
    const dated = previewHoldingsCsv(csv.replace('DUPE', 'AAPL'));
    expect(dated.detectedEffectiveDate).toBe('2026-03-31');
    expect(dated.weights.AAPL).toBe('7.10%');
    expect(dated.weights.MSFT).toBe('0.062');
    expect(dated.sectors.AAPL).toBe('Information Technology');
    expect(dated.uniqueEquityTickers).toEqual(['AAPL', 'MSFT', 'BRK.B', 'GOOG']);
    expect(dated.counts).toMatchObject({ cash: 1, duplicate: 1, ignored: 1, normalizedShareClass: 1 });
    const undated = previewHoldingsCsv('Ticker,Name\nAAPL,Apple\n');
    expect(undated.detectedEffectiveDate).toBeNull();
    const tooMany = ['Ticker,Name'];
    for (let i = 0; i < 4001; i += 1) tooMany.push(`${letters(i)},Company ${i}`);
    const capped = previewHoldingsCsv(tooMany.join('\n'));
    expect(capped.truncated).toBe(true);
    expect(capped.counts.equity).toBe(4000);
    expect(capped.uniqueEquityTickers).toHaveLength(4000);
  });

  it('handles 2,000 holdings rows without truncation', () => {
    const lines = ['Ticker,Name,Asset Class'];
    for (let i = 0; i < 2000; i += 1) lines.push(`${letters(i)},Company ${i},Equity`);
    const preview = previewHoldingsCsv(lines.join('\n'));
    expect(preview.counts.equity).toBe(2000);
    expect(preview.uniqueEquityTickers).toHaveLength(2000);
    expect(preview.rows).toHaveLength(2000);
    expect(preview.truncated).toBe(false);
  });
});

describe('holdings weight reading', () => {
  it('keeps a percent sign, a percent header, a fraction that sums to 1, and percentage points that sum to 100', () => {
    expect(interpretHoldingsWeights({ header: 'Weight', rawValues: ['7.1%', '2%'], choice: 'auto' })).toMatchObject({
      reading: 'percent-sign',
      percents: ['7.1', '2'],
    });
    expect(interpretHoldingsWeights({ header: '% of Net Assets', rawValues: ['7.1', '0.062'], choice: 'auto' })).toMatchObject({
      reading: 'percentage-points',
      percents: ['7.1', '0.062'],
    });
    expect(interpretHoldingsWeights({ header: 'Weight', rawValues: ['0.6', '0.4'], choice: 'auto' })).toMatchObject({
      reading: 'decimal-fraction',
      percents: ['60', '40'],
    });
    expect(interpretHoldingsWeights({ header: 'Weight', rawValues: ['60', '40'], choice: 'auto' })).toMatchObject({
      reading: 'percentage-points',
      percents: ['60', '40'],
    });
  });

  it('does not guess an unlabeled number that could be either scale', () => {
    const ambiguous = interpretHoldingsWeights({ header: 'Weight', rawValues: ['0.062'], choice: 'auto' });
    expect(ambiguous.reading).toBe('ambiguous');
    expect(ambiguous.percents).toEqual([null]);
    expect(interpretHoldingsWeights({ header: 'Weight', rawValues: ['0.062'], choice: 'decimal-fraction' }).percents).toEqual(['6.2']);
    expect(interpretHoldingsWeights({ header: 'Weight', rawValues: ['0.062'], choice: 'percentage-points' }).percents).toEqual(['0.062']);
    expect(interpretHoldingsWeights({ header: null, rawValues: [null, ''], choice: 'auto' }).reading).toBe('missing');
  });
});

describe('strict ticker validation', () => {
  it('rejects malformed symbols instead of stripping characters', () => {
    expect(validateTickerSymbol('T0001').ok).toBe(false);
    expect(validateTickerSymbol('A$PL').ok).toBe(false);
    expect(validateTickerSymbol('aapl')).toEqual({ ok: true, ticker: 'AAPL', normalizedFrom: null });
    expect(validateTickerSymbol('BF/B')).toEqual({ ok: true, ticker: 'BF.B', normalizedFrom: 'BF/B' });
    const { tickers, rejected } = normalizeTickerList(['T0001', 'T0002', 'T']);
    expect(tickers).toEqual(['T']);
    expect(rejected).toEqual(['T0001', 'T0002']);
  });
});

/** Deterministic alphabetic ticker for index i (A..Z, AA..ZZ, AAA..). */
export function letters(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
