import type { ParsedGreeks, ParsedQuote, ParsedTrade } from './protocol.js';

export type SymbolFreshness = 'fresh' | 'stale' | 'market_closed' | 'missing' | 'disconnected';

export interface CachedSymbol {
  instrumentId: string;
  streamerSymbol: string | null;
  quote: ParsedQuote | null;
  trade: ParsedTrade | null;
  greeks: ParsedGreeks | null;
  quoteReceivedAt: string | null;
  tradeReceivedAt: string | null;
  greeksReceivedAt: string | null;
  freshness: SymbolFreshness;
  missingStreamer: boolean;
}

export interface CacheClock {
  now: () => number;
  marketClosed: (instant: Date) => boolean;
}

const FRESH_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 64;

export class MarketDataCache {
  private readonly rows = new Map<string, CachedSymbol>();
  private readonly byStreamer = new Map<string, string>();

  constructor(private readonly clock: CacheClock) {}

  normalize(instrumentId: string): string {
    return instrumentId.trim().replace(/\s+/g, ' ');
  }

  remember(instrumentId: string, streamerSymbol: string | null): CachedSymbol {
    const id = this.normalize(instrumentId);
    const existing = this.rows.get(id);
    if (existing) {
      existing.streamerSymbol = streamerSymbol;
      existing.missingStreamer = streamerSymbol == null;
      if (streamerSymbol) this.byStreamer.set(streamerSymbol, id);
      return existing;
    }
    if (this.rows.size >= MAX_ENTRIES) {
      throw new Error('Market-data cache is full.');
    }
    const created: CachedSymbol = {
      instrumentId: id,
      streamerSymbol,
      quote: null,
      trade: null,
      greeks: null,
      quoteReceivedAt: null,
      tradeReceivedAt: null,
      greeksReceivedAt: null,
      freshness: 'missing',
      missingStreamer: streamerSymbol == null,
    };
    this.rows.set(id, created);
    if (streamerSymbol) this.byStreamer.set(streamerSymbol, id);
    return created;
  }

  applyQuote(quote: ParsedQuote, receivedAt: string): boolean {
    return this.apply(quote.streamerSymbol, quote.eventTime, (row) => row.quote?.eventTime ?? null, (row) => {
      row.quote = quote;
      row.quoteReceivedAt = receivedAt;
    });
  }

  applyTrade(trade: ParsedTrade, receivedAt: string): boolean {
    return this.apply(trade.streamerSymbol, trade.eventTime, (row) => row.trade?.eventTime ?? null, (row) => {
      row.trade = trade;
      row.tradeReceivedAt = receivedAt;
    });
  }

  applyGreeks(greeks: ParsedGreeks, receivedAt: string): boolean {
    return this.apply(greeks.streamerSymbol, greeks.eventTime, (row) => row.greeks?.eventTime ?? null, (row) => {
      row.greeks = greeks;
      row.greeksReceivedAt = receivedAt;
    });
  }

  get(instrumentId: string): CachedSymbol | null {
    const row = this.rows.get(this.normalize(instrumentId)) ?? null;
    if (!row) return null;
    row.freshness = this.freshness(row);
    return row;
  }

  entries(): CachedSymbol[] {
    return [...this.rows.values()].map((row) => ({ ...row, freshness: this.freshness(row) }));
  }

  forget(instrumentId: string): void {
    const id = this.normalize(instrumentId);
    const row = this.rows.get(id);
    if (row?.streamerSymbol) this.byStreamer.delete(row.streamerSymbol);
    this.rows.delete(id);
  }

  private apply(
    streamerSymbol: string,
    eventTime: number | null,
    previousOf: (row: CachedSymbol) => number | null,
    write: (row: CachedSymbol) => void,
  ): boolean {
    const id = this.byStreamer.get(streamerSymbol);
    if (!id) return false;
    const row = this.rows.get(id);
    if (!row) return false;
    const previous = previousOf(row);
    if (eventTime != null && previous != null && eventTime < previous) return false;
    write(row);
    return true;
  }

  private freshness(row: CachedSymbol): SymbolFreshness {
    const received = [row.quoteReceivedAt, row.tradeReceivedAt, row.greeksReceivedAt].filter((value): value is string => Boolean(value)).sort().at(-1);
    if (!received) return 'missing';
    const instant = new Date(received);
    if (Number.isNaN(instant.getTime())) return 'missing';
    if (this.clock.marketClosed(new Date(this.clock.now()))) return 'market_closed';
    return this.clock.now() - instant.getTime() <= FRESH_MS ? 'fresh' : 'stale';
  }
}
