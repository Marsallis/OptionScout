import type { WatchlistQuote, WatchlistQuotesResponse } from '@optionscout/shared';
import type { BrokerageReadClient } from '../brokerage/client.js';

const WINDOW_MS = 15_000;
export const WATCHLIST_QUOTE_LIMIT = 8;

interface CacheEntry {
  key: string;
  at: number;
  payload: WatchlistQuotesResponse;
}

let cache: CacheEntry | null = null;

export function resetWatchlistQuoteCache(): void {
  cache = null;
}

export function simulatedLast(symbol: string): number {
  let hash = 0;
  for (const char of symbol) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return Math.round((20 + (hash % 38000) / 100) * 100) / 100;
}

export function simulatedWatchlistQuote(symbol: string, now: Date): WatchlistQuote {
  return {
    symbol,
    last: simulatedLast(symbol),
    asOf: now.toISOString(),
    source: 'simulated',
    label: 'Simulated quote. Not a live price.',
    ordersEnabled: false,
  };
}

export function readCachedWatchlistQuotes(key: string, now: number): WatchlistQuotesResponse | 'limited' | null {
  if (!cache || now - cache.at >= WINDOW_MS) return null;
  if (cache.key !== key) return 'limited';
  return { ...cache.payload, rateLimited: true };
}

export function rememberWatchlistQuotes(key: string, now: number, payload: WatchlistQuotesResponse): void {
  cache = { key, at: now, payload };
}

function itemsOf(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: { items?: unknown[] } }).data;
  if (!Array.isArray(data?.items)) return [];
  return data.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function priceOf(item: Record<string, unknown> | undefined): number | null {
  if (!item) return null;
  for (const key of ['last', 'mark', 'mid']) {
    const value = Number(item[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;
  }
  return null;
}

export async function readOnlyEquityQuotes(
  client: BrokerageReadClient,
  symbols: readonly string[],
  now: Date,
): Promise<WatchlistQuote[]> {
  const body = await client.getJson('/market-data/by-type', { equity: [...symbols] });
  const items = itemsOf(body);
  return symbols.map((symbol) => {
    const item = items.find((row) => row.symbol === symbol);
    const last = priceOf(item);
    const stamp = Date.parse(typeof item?.['updated-at'] === 'string' ? item['updated-at'] : '');
    const asOf = Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
    if (last == null) {
      return {
        symbol,
        last: null,
        asOf: null,
        source: 'unavailable' as const,
        label: 'Quote unavailable.',
        ordersEnabled: false as const,
      };
    }
    return {
      symbol,
      last,
      asOf,
      source: 'tastytrade' as const,
      label: 'Read-only quote.',
      ordersEnabled: false as const,
    };
  });
}
