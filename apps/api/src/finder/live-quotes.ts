import { asDecimalString } from '../brokerage/decimals.js';
import type { BrokerageReadClient } from '../brokerage/client.js';
import { isRegularUsEquitySession } from '../brokerage/market-hours.js';
import { openLiveDxlinkSocket } from '../marketdata/live-socket.js';
import { parseQuoteToken } from '../marketdata/protocol.js';
import { DxlinkSession, type SessionSchedule } from '../marketdata/session.js';
import type { FinderQuoteSnapshot, FinderQuoteSource } from './quotes.js';

function itemsOf(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: { items?: unknown[] } }).data;
  return Array.isArray(data?.items) ? data.items : [];
}

function money(value: unknown): string | null {
  return asDecimalString(value);
}

function decimal(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const text = String(value);
  if (/^-?\d+(\.\d{1,4})?$/.test(text)) return text;
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function nodeSchedule(): SessionSchedule {
  return {
    now: () => Date.now(),
    every: (ms, fn) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    },
    later: (ms, fn) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
  };
}

export interface LiveFinderQuoteSourceOptions {
  client: BrokerageReadClient;
  /** Map streamer symbol → OCC / equity symbol for REST snapshots. */
  restSymbolByStreamer: Map<string, { symbol: string; kind: 'equity' | 'equity-option' }>;
  /** Bounded wait after subscribe before reading the cache (default 5000). */
  collectMs?: number;
  /** Extra wait when the market is closed and Greeks have not arrived yet (default 4000). */
  closedSessionExtraMs?: number;
  now?: () => Date;
}

export type GreekCoverageStatus = 'received' | 'unavailable' | 'timeout' | 'not-subscribed';

/**
 * Live Finder quotes: REST /market-data/by-type for bid/ask/volume, DXLink Quote+Greeks for streamer symbols.
 * Does not write brokerage tables. Missing Greeks stay null.
 */
export class LiveFinderQuoteSource implements FinderQuoteSource {
  private session: DxlinkSession | null = null;
  private started = false;
  requestCount = { rest: 0, dxlinkBatches: 0, quoteToken: 0 };
  /** Last batch Greek coverage diagnostics (not fabricated deltas). */
  lastGreekCoverage: { status: GreekCoverageStatus; received: number; missing: number; waitedMs: number } = {
    status: 'not-subscribed',
    received: 0,
    missing: 0,
    waitedMs: 0,
  };

  constructor(private readonly options: LiveFinderQuoteSourceOptions) {}

  registerRestSymbol(streamerSymbol: string, symbol: string, kind: 'equity' | 'equity-option'): void {
    this.options.restSymbolByStreamer.set(streamerSymbol, { symbol, kind });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.requestCount.quoteToken += 1;
    const tokenBody = await this.options.client.getJson('/api-quote-tokens');
    const token = parseQuoteToken(tokenBody);
    this.session = new DxlinkSession({
      tokens: {
        async getQuoteToken() {
          return { ...token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
        },
      },
      connect: (url) => openLiveDxlinkSocket(url),
      schedule: nodeSchedule(),
      researchLimit: 8,
      eventTypes: ['Quote', 'Greeks'],
    });
    await this.session.start();
    const ready = await this.session.waitForFeed(20_000);
    if (!ready) {
      throw new Error('DXLink feed did not become ready within 20 seconds.');
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    this.session?.stop();
    this.session = null;
    this.started = false;
  }

  async fetchQuotes(streamerSymbols: readonly string[]): Promise<Map<string, FinderQuoteSnapshot>> {
    const now = this.options.now?.() ?? new Date();
    const receivedAt = now.toISOString();
    const map = new Map<string, FinderQuoteSnapshot>();

    const restTargets = streamerSymbols
      .map((streamer) => {
        const rest = this.options.restSymbolByStreamer.get(streamer);
        return rest ? { streamer, ...rest } : null;
      })
      .filter((row): row is { streamer: string; symbol: string; kind: 'equity' | 'equity-option' } => row != null);

    if (restTargets.length > 0) {
      this.requestCount.rest += 1;
      const query: Record<string, string[]> = {};
      const equities = restTargets.filter((row) => row.kind === 'equity').map((row) => row.symbol);
      const options = restTargets.filter((row) => row.kind === 'equity-option').map((row) => row.symbol);
      if (equities.length > 0) query.equity = equities;
      if (options.length > 0) query['equity-option'] = options;
      const body = await this.options.client.getJson('/market-data/by-type', query);
      const items = itemsOf(body);
      for (const target of restTargets) {
        const quote = items.find((item) => item && typeof item === 'object' && (item as { symbol?: string }).symbol === target.symbol) as
          | Record<string, unknown>
          | undefined;
        const asOf = typeof quote?.['updated-at'] === 'string' ? quote['updated-at'] : null;
        map.set(target.streamer, {
          streamerSymbol: target.streamer,
          bid: money(quote?.bid),
          ask: money(quote?.ask),
          mark: money(quote?.mark) ?? money(quote?.mid),
          delta: null,
          theta: null,
          gamma: null,
          vega: null,
          impliedVolatility: null,
          volume: typeof quote?.volume === 'number' ? Math.trunc(quote.volume) : quote?.volume != null ? Number(quote.volume) || null : null,
          openInterest: null,
          providerEventAt: asOf,
          greekEventAt: null,
          receivedAt,
          sourceLabel: 'tastytrade REST /market-data/by-type ask (not a midpoint fill)',
        });
      }
    }

    if (!this.session) await this.start();
    const session = this.session!;
    this.requestCount.dxlinkBatches += 1;
    const consumerId = `finder-live-${Date.now()}`;
    const optionStreamers = streamerSymbols.filter((streamer) => this.options.restSymbolByStreamer.get(streamer)?.kind !== 'equity');
    for (const streamer of streamerSymbols) {
      const rest = this.options.restSymbolByStreamer.get(streamer);
      session.subscribe({
        consumerId,
        instrumentId: rest?.symbol ?? streamer,
        streamerSymbol: streamer,
        purpose: 'research',
      });
    }

    const baseWait = this.options.collectMs ?? 5000;
    const closedExtra = this.options.closedSessionExtraMs ?? 4000;
    const closed = !isRegularUsEquitySession(now);
    const startedWait = Date.now();
    const deadline = startedWait + baseWait + (closed ? closedExtra : 0);
    // Poll until Greeks arrive for option symbols or the bounded deadline hits.
    // Missing Greeks after the wait are "unavailable/timeout", not a protocol failure.
    while (Date.now() < deadline) {
      let pendingGreeks = 0;
      for (const streamer of optionStreamers) {
        const rest = this.options.restSymbolByStreamer.get(streamer);
        const cached = session.snapshot(rest?.symbol ?? streamer).row;
        if (cached?.greeks?.delta == null) pendingGreeks += 1;
      }
      if (pendingGreeks === 0 && optionStreamers.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const waitedMs = Date.now() - startedWait;

    let greekReceived = 0;
    for (const streamer of streamerSymbols) {
      const rest = this.options.restSymbolByStreamer.get(streamer);
      const cached = session.snapshot(rest?.symbol ?? streamer).row;
      const existing = map.get(streamer);
      const quoteBid = cached?.quote?.bid != null ? decimal(cached.quote.bid) : null;
      const quoteAsk = cached?.quote?.ask != null ? decimal(cached.quote.ask) : null;
      const providerEventAt =
        cached?.quote?.eventTime != null
          ? new Date(cached.quote.eventTime).toISOString()
          : existing?.providerEventAt ?? null;
      const greekEventAt = cached?.greeks?.eventTime != null ? new Date(cached.greeks.eventTime).toISOString() : null;
      const delta = decimal(cached?.greeks?.delta ?? null);
      if (rest?.kind !== 'equity' && delta != null) greekReceived += 1;
      map.set(streamer, {
        streamerSymbol: streamer,
        bid: quoteBid ?? existing?.bid ?? null,
        ask: quoteAsk ?? existing?.ask ?? null,
        mark: existing?.mark ?? null,
        delta,
        theta: decimal(cached?.greeks?.theta ?? null),
        gamma: decimal(cached?.greeks?.gamma ?? null),
        vega: decimal(cached?.greeks?.vega ?? null),
        impliedVolatility: decimal(cached?.greeks?.volatility ?? null),
        volume: existing?.volume ?? null,
        openInterest: null,
        providerEventAt,
        greekEventAt,
        receivedAt: cached?.quoteReceivedAt ?? cached?.greeksReceivedAt ?? receivedAt,
        sourceLabel:
          quoteAsk != null
            ? 'DXLink Quote ask + Greeks (REST filled gaps)'
            : existing?.ask != null
              ? 'tastytrade REST ask + DXLink Greeks when available'
              : 'DXLink/REST with unavailable ask',
      });
      session.unsubscribe(consumerId, rest?.symbol ?? streamer);
    }
    session.unsubscribe(consumerId);

    const greekMissing = Math.max(0, optionStreamers.length - greekReceived);
    this.lastGreekCoverage = {
      status:
        optionStreamers.length === 0
          ? 'not-subscribed'
          : greekMissing === 0
            ? 'received'
            : closed
              ? 'unavailable'
              : 'timeout',
      received: greekReceived,
      missing: greekMissing,
      waitedMs,
    };

    for (const streamer of streamerSymbols) {
      if (!map.has(streamer)) {
        map.set(streamer, {
          streamerSymbol: streamer,
          bid: null,
          ask: null,
          mark: null,
          delta: null,
          theta: null,
          gamma: null,
          vega: null,
          impliedVolatility: null,
          volume: null,
          openInterest: null,
          providerEventAt: null,
          greekEventAt: null,
          receivedAt,
          sourceLabel: 'no quote',
        });
      }
    }
    return map;
  }
}
