/**
 * Simulated multi-ticker option chains and quotes for Phase 1D.2a Smart Scan MVP.
 * Labeled simulated — never presented as live brokerage data.
 */

import type { FinderQuoteSnapshot, FinderQuoteSource } from './quotes.js';

const SOURCE_LABEL = 'SIMULATED smart-scan fixture ask (not live market data)';

/** Special QA tickers for unsupported / empty / missing-greeks paths. */
export const SMART_MOCK_SPECIAL = {
  EMPTY: 'ZZEMP',
  UNSUPPORTED: 'ZZBAD',
  NOGREEKS: 'ZZGRK',
  /** Bid is above the ask. Labeled simulated. Not a live quote. */
  INCONSISTENT: 'ZZINV',
  /** Priced to pass the built-in revision-1 hard rules and preferences. Simulated only. */
  BEST: 'ZZBEST',
  /** Passes hard rules and misses the preferred cost or intrinsic target. Simulated only. */
  NEAR: 'ZZNEAR',
  /** Fails the minimum expiration. Simulated only. */
  OUTSIDE: 'ZZOUT',
} as const;

function money(value: number): string {
  return value.toFixed(2);
}

function decimal(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function padOccRoot(symbol: string): string {
  return symbol.padEnd(6, ' ');
}

/** Deterministic mock spot so different companies produce different moneyness. */
export function mockSpotForTicker(ticker: string): string {
  const symbol = ticker.trim().toUpperCase();
  if (
    symbol === SMART_MOCK_SPECIAL.NOGREEKS ||
    symbol === SMART_MOCK_SPECIAL.INCONSISTENT ||
    symbol === SMART_MOCK_SPECIAL.BEST ||
    symbol === SMART_MOCK_SPECIAL.NEAR ||
    symbol === SMART_MOCK_SPECIAL.OUTSIDE
  ) {
    return '80.00';
  }
  if (symbol === SMART_MOCK_SPECIAL.EMPTY || symbol === SMART_MOCK_SPECIAL.UNSUPPORTED) return '50.00';
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  const spot = 40 + (hash % 360) + (hash % 10) / 10;
  return money(spot);
}

function practiceChain(symbol: string, expiration: string, yymmdd: string, dte: number): unknown {
  const strike = 35;
  return {
    data: {
      items: [
        {
          'underlying-symbol': symbol,
          'root-symbol': symbol,
          'option-chain-type': 'Standard',
          'shares-per-contract': 100,
          deliverables: [
            {
              id: 1,
              amount: '100',
              'deliverable-type': 'stock',
              description: `${symbol} shares (simulated practice case)`,
              'instrument-type': 'Equity',
              percent: '100',
              'root-symbol': symbol,
              symbol,
            },
          ],
          expirations: [
            {
              'expiration-type': 'Regular',
              'expiration-date': expiration,
              'days-to-expiration': dte,
              'settlement-type': 'PM',
              strikes: [
                {
                  'strike-price': strike,
                  call: occCall(symbol, yymmdd, strike),
                  'call-streamer-symbol': streamerCall(symbol, yymmdd, strike),
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function occCall(symbol: string, yymmdd: string, strike: number): string {
  const strikeInt = Math.round(strike * 1000);
  return `${padOccRoot(symbol)}${yymmdd}C${String(strikeInt).padStart(8, '0')}`;
}

function streamerCall(symbol: string, yymmdd: string, strike: number): string {
  return `.${symbol}${yymmdd}C${strike}`;
}

/**
 * Build a nested-chain-shaped payload for Smart Scan simulated mode.
 * Real ticker symbols may appear; payload remains explicitly simulated.
 */
export function smartMockNestedChainPayload(underlying: string): unknown {
  const symbol = underlying.trim().toUpperCase();
  if (symbol === SMART_MOCK_SPECIAL.EMPTY) {
    return { data: { items: [] } };
  }
  if (
    symbol === SMART_MOCK_SPECIAL.BEST ||
    symbol === SMART_MOCK_SPECIAL.NEAR ||
    symbol === SMART_MOCK_SPECIAL.NOGREEKS ||
    symbol === SMART_MOCK_SPECIAL.INCONSISTENT
  ) {
    return practiceChain(symbol, '2028-01-21', '280121', 463);
  }
  if (symbol === SMART_MOCK_SPECIAL.OUTSIDE) {
    return practiceChain(symbol, '2027-01-15', '270115', 90);
  }

  if (symbol === SMART_MOCK_SPECIAL.UNSUPPORTED) {
    return {
      data: {
        items: [
          {
            'underlying-symbol': symbol,
            'root-symbol': `${symbol}1`,
            'option-chain-type': 'Adjusted',
            'shares-per-contract': 150,
            deliverables: [
              {
                id: 1,
                amount: '150',
                'deliverable-type': 'stock',
                description: `${symbol} adjusted (unsupported)`,
                'instrument-type': 'Equity',
                percent: '100',
                'root-symbol': `${symbol}1`,
                symbol,
              },
            ],
            expirations: [
              {
                'expiration-type': 'Regular',
                'expiration-date': '2028-01-21',
                'days-to-expiration': 463,
                'settlement-type': 'PM',
                strikes: [
                  {
                    'strike-price': 40,
                    call: `${padOccRoot(`${symbol}1`)}280121C00040000`,
                    'call-streamer-symbol': `.${symbol}1C40`,
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  }

  const spot = Number(mockSpotForTicker(symbol));
  const deepItm = Math.max(5, Math.round(spot * 0.45));
  const midItm = Math.max(deepItm + 5, Math.round(spot * 0.7));
  const nearAtm = Math.max(midItm + 5, Math.round(spot * 0.95));
  const otm = Math.round(spot * 1.1);

  return {
    data: {
      items: [
        {
          'underlying-symbol': symbol,
          'root-symbol': symbol,
          'option-chain-type': 'Standard',
          'shares-per-contract': 100,
          deliverables: [
            {
              id: 1,
              amount: '100',
              'deliverable-type': 'stock',
              description: `${symbol} shares (simulated)`,
              'instrument-type': 'Equity',
              percent: '100',
              'root-symbol': symbol,
              symbol,
            },
          ],
          expirations: [
            {
              'expiration-type': 'Regular',
              'expiration-date': '2028-01-21',
              'days-to-expiration': 463,
              'settlement-type': 'PM',
              strikes: [
                {
                  'strike-price': deepItm,
                  call: occCall(symbol, '280121', deepItm),
                  'call-streamer-symbol': streamerCall(symbol, '280121', deepItm),
                },
                {
                  'strike-price': midItm,
                  call: occCall(symbol, '280121', midItm),
                  'call-streamer-symbol': streamerCall(symbol, '280121', midItm),
                },
                {
                  'strike-price': nearAtm,
                  call: occCall(symbol, '280121', nearAtm),
                  'call-streamer-symbol': streamerCall(symbol, '280121', nearAtm),
                },
                {
                  'strike-price': otm,
                  call: occCall(symbol, '280121', otm),
                  'call-streamer-symbol': streamerCall(symbol, '280121', otm),
                },
              ],
            },
            {
              'expiration-type': 'Regular',
              'expiration-date': '2028-06-16',
              'days-to-expiration': 610,
              'settlement-type': 'PM',
              strikes: [
                {
                  'strike-price': midItm,
                  call: occCall(symbol, '280616', midItm),
                  'call-streamer-symbol': streamerCall(symbol, '280616', midItm),
                },
                {
                  'strike-price': deepItm,
                  call: occCall(symbol, '280616', deepItm),
                  'call-streamer-symbol': streamerCall(symbol, '280616', deepItm),
                },
              ],
            },
            {
              'expiration-type': 'Regular',
              'expiration-date': '2027-01-15',
              'days-to-expiration': 90,
              'settlement-type': 'PM',
              strikes: [
                {
                  'strike-price': nearAtm,
                  call: occCall(symbol, '270115', nearAtm),
                  'call-streamer-symbol': streamerCall(symbol, '270115', nearAtm),
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function parseStrikeFromStreamer(streamerSymbol: string): number | null {
  const match = /C(\d+(?:\.\d+)?)$/i.exec(streamerSymbol.replace(/\s+/g, ''));
  if (!match) return null;
  const strike = Number(match[1]);
  return Number.isFinite(strike) ? strike : null;
}

function underlyingFromStreamer(streamerSymbol: string): string {
  const match = /^\.([A-Z.]+)\d{6}C/i.exec(streamerSymbol.replace(/\s+/g, ''));
  return match?.[1]?.toUpperCase() ?? 'UNK';
}

function coherentQuote(
  streamerSymbol: string,
  nowIso: string,
  options?: { omitGreeks?: boolean },
): FinderQuoteSnapshot {
  const underlying = underlyingFromStreamer(streamerSymbol);
  const stock = Number(mockSpotForTicker(underlying));
  const strike = parseStrikeFromStreamer(streamerSymbol) ?? stock * 0.7;
  const intrinsic = Math.max(0, stock - strike);
  const moneyness = stock > 0 ? (stock - strike) / stock : 0;
  const delta = Math.min(0.95, Math.max(0.28, 0.55 + moneyness * 0.6));
  const extrinsic = Math.max(0.8, 4.5 - moneyness * 3);
  const ask = intrinsic + extrinsic + (underlying === SMART_MOCK_SPECIAL.NEAR ? 18 : 0);
  const bid = Math.max(0.05, ask - Math.min(1.5, Math.max(0.3, ask * 0.025)));
  const omitGreeks = options?.omitGreeks === true || underlying === SMART_MOCK_SPECIAL.NOGREEKS;
  const crossed = underlying === SMART_MOCK_SPECIAL.INCONSISTENT;

  return {
    streamerSymbol,
    bid: money(crossed ? ask + 1 : bid),
    ask: money(ask),
    mark: money((bid + ask) / 2),
    delta: omitGreeks ? null : decimal(delta),
    theta: omitGreeks ? null : decimal(-0.015 - (1 - delta) * 0.02),
    gamma: omitGreeks ? null : decimal(0.005),
    vega: omitGreeks ? null : decimal(0.3),
    impliedVolatility: omitGreeks ? null : decimal(0.28),
    volume: 40,
    openInterest: omitGreeks ? null : 500,
    providerEventAt: nowIso,
    greekEventAt: omitGreeks ? null : nowIso,
    receivedAt: nowIso,
    sourceLabel: crossed
      ? 'SIMULATED inconsistent quote: bid is above the ask (not live market data)'
      : SOURCE_LABEL,
  };
}

export class SmartMockQuoteSource implements FinderQuoteSource {
  constructor(private readonly nowIso: string) {}

  async fetchQuotes(streamerSymbols: readonly string[]): Promise<Map<string, FinderQuoteSnapshot>> {
    const map = new Map<string, FinderQuoteSnapshot>();
    for (const streamerSymbol of streamerSymbols) {
      map.set(streamerSymbol, coherentQuote(streamerSymbol, this.nowIso));
    }
    return map;
  }
}
