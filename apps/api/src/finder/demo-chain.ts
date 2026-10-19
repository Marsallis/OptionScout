import type { FinderQuoteSnapshot, FinderQuoteSource } from './quotes.js';

/** Fictional underlying used by the labeled demo fixture. Never a real issuer. */
export const DEMO_UNDERLYING = 'DEMO';
/** Spot used for all DEMO fixture quotes and intrinsic math. */
export const DEMO_SPOT = '100.00';

const DEMO_SPECIAL = new Set(['DEMO', 'EMPTY', 'MISSING']);

export function isDemoFixtureSymbol(symbol: string): boolean {
  return DEMO_SPECIAL.has(symbol.trim().toUpperCase());
}

/**
 * Labeled local fixture used when FINDER_LIVE_SCAN is false / portfolio view is demo.
 * Only DEMO (plus EMPTY/MISSING test hooks) is supported — never relabel this chain as AAPL/QCOM.
 */
export function demoNestedChainPayload(underlying: string): unknown {
  const symbol = underlying.trim().toUpperCase() || DEMO_UNDERLYING;
  if (symbol === 'EMPTY') {
    return { data: { items: [] } };
  }
  if (symbol === 'MISSING') {
    return { data: { items: [] } };
  }
  if (symbol !== DEMO_UNDERLYING) {
    throw new Error(`Demo fixture chain is only defined for ${DEMO_UNDERLYING}, not ${symbol}.`);
  }
  return {
    data: {
      items: [
        {
          'underlying-symbol': DEMO_UNDERLYING,
          'root-symbol': DEMO_UNDERLYING,
          'option-chain-type': 'Standard',
          'shares-per-contract': 100,
          deliverables: [
            {
              id: 1,
              amount: '100',
              'deliverable-type': 'stock',
              description: `${DEMO_UNDERLYING} shares (simulated)`,
              'instrument-type': 'Equity',
              percent: '100',
              'root-symbol': DEMO_UNDERLYING,
              symbol: DEMO_UNDERLYING,
            },
          ],
          expirations: [
            {
              'expiration-type': 'Regular',
              'expiration-date': '2029-01-19',
              'days-to-expiration': 827,
              'settlement-type': 'PM',
              strikes: [
                { 'strike-price': 40, call: `${DEMO_UNDERLYING}   290119C00040000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}290119C40` },
                { 'strike-price': 45, call: `${DEMO_UNDERLYING}   290119C00045000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}290119C45` },
                { 'strike-price': 25, call: `${DEMO_UNDERLYING}   290119C00025000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}290119C25` },
                { 'strike-price': 80, call: `${DEMO_UNDERLYING}   290119C00080000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}290119C80` },
              ],
            },
            {
              'expiration-type': 'Regular',
              'expiration-date': '2028-12-15',
              'days-to-expiration': 792,
              'settlement-type': 'PM',
              strikes: [
                { 'strike-price': 40, call: `${DEMO_UNDERLYING}   281215C00040000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}281215C40` },
                { 'strike-price': 35, call: `${DEMO_UNDERLYING}   281215C00035000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}281215C35` },
                { 'strike-price': 15, call: `${DEMO_UNDERLYING}   281215C00015000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}281215C15` },
              ],
            },
            {
              'expiration-type': 'Regular',
              'expiration-date': '2028-06-16',
              'days-to-expiration': 610,
              'settlement-type': 'PM',
              strikes: [
                { 'strike-price': 45, call: `${DEMO_UNDERLYING}   280616C00045000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}280616C45` },
                { 'strike-price': 30, call: `${DEMO_UNDERLYING}   280616C00030000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}280616C30` },
                { 'strike-price': 90, call: `${DEMO_UNDERLYING}   280616C00090000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}280616C90` },
              ],
            },
            {
              'expiration-type': 'Regular',
              'expiration-date': '2028-01-21',
              'days-to-expiration': 463,
              'settlement-type': 'PM',
              strikes: [
                { 'strike-price': 40, call: `${DEMO_UNDERLYING}   280121C00040000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}280121C40` },
                { 'strike-price': 50, call: `${DEMO_UNDERLYING}   280121C00050000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}280121C50` },
                { 'strike-price': 10, call: `${DEMO_UNDERLYING}   280121C00010000`, 'call-streamer-symbol': `.${DEMO_UNDERLYING}280121C10` },
                {
                  'strike-price': 70,
                  call: `${DEMO_UNDERLYING}   280121C00070000`,
                  put: `${DEMO_UNDERLYING}   280121P00070000`,
                  'put-streamer-symbol': `.${DEMO_UNDERLYING}280121P70`,
                },
                {
                  'strike-price': 110,
                  call: `${DEMO_UNDERLYING}   280121C00110000`,
                  'call-streamer-symbol': `.${DEMO_UNDERLYING}280121C110`,
                },
                {
                  'strike-price': 100,
                  call: `${DEMO_UNDERLYING}   280121C00100000`,
                  'call-streamer-symbol': `.${DEMO_UNDERLYING}280121C100`,
                  put: `${DEMO_UNDERLYING}   280121P00100000`,
                  'put-streamer-symbol': `.${DEMO_UNDERLYING}280121P100`,
                },
              ],
            },
            {
              'expiration-type': 'Regular',
              'expiration-date': '2026-12-18',
              'days-to-expiration': 64,
              'settlement-type': 'PM',
              strikes: [
                {
                  'strike-price': 100,
                  call: `${DEMO_UNDERLYING}   261218C00100000`,
                  'call-streamer-symbol': `.${DEMO_UNDERLYING}261218C100`,
                },
              ],
            },
          ],
        },
        {
          'underlying-symbol': DEMO_UNDERLYING,
          'root-symbol': `${DEMO_UNDERLYING}1`,
          'option-chain-type': 'Adjusted',
          'shares-per-contract': 150,
          deliverables: [
            {
              id: 2,
              amount: '150',
              'deliverable-type': 'stock',
              description: `${DEMO_UNDERLYING} adjusted (unsupported)`,
              'instrument-type': 'Equity',
              percent: '100',
              'root-symbol': `${DEMO_UNDERLYING}1`,
              symbol: DEMO_UNDERLYING,
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
                  'strike-price': 55,
                  call: `${DEMO_UNDERLYING}1  280121C00055000`,
                  'call-streamer-symbol': `.${DEMO_UNDERLYING}1C55`,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export function demoEquityStreamer(underlying: string): string {
  return underlying.trim().toUpperCase() || DEMO_UNDERLYING;
}

function money(value: number): string {
  return value.toFixed(2);
}

function decimal(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function parseCallStrike(streamerSymbol: string): number | null {
  const match = /C(\d+(?:\.\d+)?)$/i.exec(streamerSymbol.replace(/\s+/g, ''));
  if (!match) return null;
  const strike = Number(match[1]);
  return Number.isFinite(strike) ? strike : null;
}

/**
 * Build a call quote that is coherent with DEMO spot:
 * ask ≈ intrinsic + small extrinsic, delta rises with moneyness.
 * Special cases: crossed market (C110) and short-dated ATM (261218C100).
 */
function coherentCallQuote(
  streamerSymbol: string,
  stock: number,
  nowIso: string,
  providerEventAt: string | null,
): FinderQuoteSnapshot {
  const sourceLabel = 'SIMULATED demo-fixture ask (not live market data)';
  const base = {
    streamerSymbol,
    volume: 25 as number | null,
    openInterest: 400 as number | null,
    providerEventAt,
    greekEventAt: providerEventAt,
    receivedAt: nowIso,
    sourceLabel,
  };

  // Intentional incomplete/crossed row for UI + classifier tests.
  if (streamerSymbol.endsWith('C110')) {
    return {
      ...base,
      bid: '8.00',
      ask: '7.50',
      mark: null,
      delta: decimal(0.35),
      theta: decimal(-0.02),
      gamma: decimal(0.02),
      vega: decimal(0.25),
      impliedVolatility: decimal(0.32),
      volume: 5,
      openInterest: 40,
    };
  }

  // Short-dated ATM: small premium, lower delta — still consistent with spot 100 / strike 100.
  if (streamerSymbol.includes('261218') && streamerSymbol.endsWith('C100')) {
    return {
      ...base,
      bid: '3.80',
      ask: '4.20',
      mark: money(4),
      delta: decimal(0.52),
      theta: decimal(-0.06),
      gamma: decimal(0.03),
      vega: decimal(0.2),
      impliedVolatility: decimal(0.28),
      volume: 80,
      openInterest: 200,
    };
  }

  const strike = parseCallStrike(streamerSymbol) ?? 50;
  const intrinsic = Math.max(0, stock - strike);
  // Coherent LEAPS-style examples keyed by strike for DEMO spot = 100.
  const byStrike: Record<number, { extrinsic: number; delta: number }> = {
    10: { extrinsic: 2.5, delta: 0.94 },
    15: { extrinsic: 2.2, delta: 0.92 },
    25: { extrinsic: 2.0, delta: 0.9 },
    30: { extrinsic: 1.8, delta: 0.88 },
    35: { extrinsic: 1.6, delta: 0.85 },
    40: { extrinsic: 1.5, delta: 0.82 },
    45: { extrinsic: 1.4, delta: 0.8 },
    50: { extrinsic: 2.0, delta: 0.78 },
    80: { extrinsic: 3.5, delta: 0.72 },
    90: { extrinsic: 4.0, delta: 0.7 },
    100: { extrinsic: 4.5, delta: 0.75 },
  };
  const profile = byStrike[strike] ?? {
    extrinsic: intrinsic <= 0 ? Math.max(1.5, 6 - (strike - stock) * 0.1) : Math.max(1, 5 - intrinsic * 0.04),
    delta: Math.min(0.95, Math.max(0.25, 0.55 + ((stock - strike) / stock) * 0.55)),
  };
  const ask = intrinsic + profile.extrinsic;
  const bid = Math.max(0.05, ask - Math.min(1.25, Math.max(0.35, ask * 0.02)));
  const delta = profile.delta;

  return {
    ...base,
    bid: money(bid),
    ask: money(ask),
    mark: money((bid + ask) / 2),
    delta: decimal(delta),
    theta: decimal(-0.012 - (1 - delta) * 0.02),
    gamma: decimal(0.004 + (1 - delta) * 0.01),
    vega: decimal(0.25 + (1 - delta) * 0.2),
    impliedVolatility: decimal(0.26 + (1 - delta) * 0.06),
  };
}

/**
 * Deterministic DEMO quote fixtures keyed by streamer.
 * Quotes are derived from DEMO_SPOT so intrinsic / cost / delta stay economically coherent.
 */
export class DemoFinderQuoteSource implements FinderQuoteSource {
  constructor(
    private readonly underlyingPrice: string,
    private readonly nowIso: string,
    private readonly options?: { afterHours?: boolean; providerTimestamp?: boolean },
  ) {}

  async fetchQuotes(streamerSymbols: readonly string[]): Promise<Map<string, FinderQuoteSnapshot>> {
    const map = new Map<string, FinderQuoteSnapshot>();
    const providerEventAt = this.options?.providerTimestamp === false ? null : this.nowIso;
    const stock = Number(this.underlyingPrice);
    for (const streamerSymbol of streamerSymbols) {
      map.set(streamerSymbol, coherentCallQuote(streamerSymbol, Number.isFinite(stock) ? stock : 100, this.nowIso, providerEventAt));
    }
    return map;
  }

  underlyingQuote(streamerSymbol: string): FinderQuoteSnapshot {
    return {
      streamerSymbol,
      bid: this.underlyingPrice,
      ask: this.underlyingPrice,
      mark: this.underlyingPrice,
      delta: null,
      theta: null,
      gamma: null,
      vega: null,
      impliedVolatility: null,
      volume: null,
      openInterest: null,
      providerEventAt: this.options?.providerTimestamp === false ? null : this.nowIso,
      greekEventAt: null,
      receivedAt: this.nowIso,
      sourceLabel: 'SIMULATED demo-fixture underlying (not live market data)',
    };
  }
}
