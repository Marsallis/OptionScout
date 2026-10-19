import { ALLOWED_DXLINK_URLS } from '../brokerage/client.js';

export const DXLINK_VERSION = '0.1-DXF-JS/0.3.0';
export const FEED_CHANNEL = 3;

export const QUOTE_FIELDS = ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize', 'time'] as const;
export const TRADE_FIELDS = ['eventType', 'eventSymbol', 'price', 'dayVolume', 'size', 'time'] as const;
export const GREEK_FIELDS = ['eventType', 'eventSymbol', 'volatility', 'delta', 'gamma', 'theta', 'rho', 'vega', 'time'] as const;

export type FeedEventType = 'Quote' | 'Trade' | 'Greeks';

export function assertDxlinkUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DXLink address is not a URL.');
  }
  if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('DXLink address is not an allowed market-data socket.');
  }
  if (!ALLOWED_DXLINK_URLS.includes(parsed.href as (typeof ALLOWED_DXLINK_URLS)[number])) {
    throw new Error('DXLink address is not an allowed market-data socket.');
  }
}

export function setupFrame(): string {
  return JSON.stringify({ type: 'SETUP', channel: 0, version: DXLINK_VERSION, keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
}

export function authFrame(token: string): string {
  return JSON.stringify({ type: 'AUTH', channel: 0, token });
}

export function channelRequestFrame(): string {
  return JSON.stringify({ type: 'CHANNEL_REQUEST', channel: FEED_CHANNEL, service: 'FEED', parameters: { contract: 'AUTO' } });
}

export function feedSetupFrame(): string {
  return JSON.stringify({
    type: 'FEED_SETUP',
    channel: FEED_CHANNEL,
    acceptAggregationPeriod: 0.1,
    acceptDataFormat: 'COMPACT',
    acceptEventFields: {
      Quote: [...QUOTE_FIELDS],
      Trade: [...TRADE_FIELDS],
      Greeks: [...GREEK_FIELDS],
    },
  });
}

export function keepaliveFrame(): string {
  return JSON.stringify({ type: 'KEEPALIVE', channel: 0 });
}

export function subscriptionFrame(
  symbols: readonly string[],
  reset: boolean,
  eventTypes: readonly FeedEventType[] = ['Quote', 'Trade', 'Greeks'],
): string {
  const add = symbols.flatMap((symbol) => eventTypes.map((type) => ({ type, symbol })));
  return JSON.stringify({ type: 'FEED_SUBSCRIPTION', channel: FEED_CHANNEL, reset, add });
}

export function removalFrame(symbols: readonly string[], eventTypes: readonly FeedEventType[] = ['Quote', 'Trade', 'Greeks']): string {
  const remove = symbols.flatMap((symbol) => eventTypes.map((type) => ({ type, symbol })));
  return JSON.stringify({ type: 'FEED_SUBSCRIPTION', channel: FEED_CHANNEL, reset: false, remove });
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface ParsedQuote {
  streamerSymbol: string;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  eventTime: number | null;
}

export interface ParsedTrade {
  streamerSymbol: string;
  price: number | null;
  dayVolume: number | null;
  size: number | null;
  eventTime: number | null;
}

export interface ParsedGreeks {
  streamerSymbol: string;
  volatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  rho: number | null;
  vega: number | null;
  eventTime: number | null;
}

export type ParsedFeed = { kind: 'quote'; quote: ParsedQuote } | { kind: 'trade'; trade: ParsedTrade } | { kind: 'greeks'; greeks: ParsedGreeks };

function rowValue(row: unknown[], index: number): unknown {
  return row[index];
}

export function parseFeedData(frame: unknown): ParsedFeed[] {
  if (!frame || typeof frame !== 'object') return [];
  const message = frame as { type?: unknown; data?: unknown };
  if (message.type !== 'FEED_DATA' || !Array.isArray(message.data)) return [];
  const parsed: ParsedFeed[] = [];
  for (let index = 0; index < message.data.length; index += 1) {
    const label = message.data[index];
    const row = message.data[index + 1];
    if (typeof label !== 'string' || !Array.isArray(row)) continue;
    index += 1;
    const symbol = row[1];
    if (typeof symbol !== 'string' || symbol.trim() === '') continue;
    if (label === 'Quote') {
      parsed.push({
        kind: 'quote',
        quote: {
          streamerSymbol: symbol,
          bid: finiteNumber(rowValue(row, 2)),
          ask: finiteNumber(rowValue(row, 3)),
          bidSize: finiteNumber(rowValue(row, 4)),
          askSize: finiteNumber(rowValue(row, 5)),
          eventTime: finiteNumber(rowValue(row, 6)),
        },
      });
    } else if (label === 'Trade') {
      parsed.push({
        kind: 'trade',
        trade: {
          streamerSymbol: symbol,
          price: finiteNumber(rowValue(row, 2)),
          dayVolume: finiteNumber(rowValue(row, 3)),
          size: finiteNumber(rowValue(row, 4)),
          eventTime: finiteNumber(rowValue(row, 5)),
        },
      });
    } else if (label === 'Greeks') {
      parsed.push({
        kind: 'greeks',
        greeks: {
          streamerSymbol: symbol,
          volatility: finiteNumber(rowValue(row, 2)),
          delta: finiteNumber(rowValue(row, 3)),
          gamma: finiteNumber(rowValue(row, 4)),
          theta: finiteNumber(rowValue(row, 5)),
          rho: finiteNumber(rowValue(row, 6)),
          vega: finiteNumber(rowValue(row, 7)),
          eventTime: finiteNumber(rowValue(row, 8)),
        },
      });
    }
  }
  return parsed;
}

export interface QuoteTokenPayload {
  token: string;
  dxlinkUrl: string;
  level: string;
}

export function parseQuoteToken(payload: unknown): QuoteTokenPayload {
  if (!payload || typeof payload !== 'object') throw new Error('Quote token response was incomplete.');
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw new Error('Quote token response was incomplete.');
  const record = data as Record<string, unknown>;
  if (typeof record.token !== 'string' || record.token.trim() === '' || typeof record['dxlink-url'] !== 'string') {
    throw new Error('Quote token response was incomplete.');
  }
  assertDxlinkUrl(record['dxlink-url']);
  return { token: record.token, dxlinkUrl: record['dxlink-url'], level: typeof record.level === 'string' ? record.level : 'unknown' };
}
