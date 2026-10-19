import { isRegularUsEquitySession } from '../brokerage/market-hours.js';
import { MarketDataCache, type CachedSymbol, type SymbolFreshness } from './cache.js';
import {
  assertDxlinkUrl,
  authFrame,
  channelRequestFrame,
  feedSetupFrame,
  keepaliveFrame,
  parseFeedData,
  removalFrame,
  setupFrame,
  subscriptionFrame,
  type FeedEventType,
  type QuoteTokenPayload,
} from './protocol.js';

export interface DxlinkSocket {
  send(frame: string): void;
  close(): void;
  onMessage(handler: (frame: string) => void): void;
  onClose(handler: () => void): void;
}

export interface QuoteTokenSource {
  getQuoteToken(): Promise<QuoteTokenPayload & { expiresAt: number }>;
}

export interface SessionSchedule {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  later(ms: number, fn: () => void): () => void;
}

const RESEARCH_LIMIT = 8;
const TOKEN_RENEW_MS = 5 * 60 * 1000;
const BACKOFF = [1000, 2000, 4000, 8000, 30000];

export interface SubscriptionRequest {
  consumerId: string;
  instrumentId: string;
  streamerSymbol: string | null;
  purpose: 'position' | 'research';
}

export class DxlinkSession {
  private socket: DxlinkSocket | null = null;
  private phase: 'idle' | 'setup' | 'auth' | 'channel' | 'feed' = 'idle';
  private running = false;
  private attempt = 0;
  private cancelKeepalive: (() => void) | null = null;
  private cancelReconnect: (() => void) | null = null;
  private readonly consumers = new Map<string, Map<string, SubscriptionRequest>>();
  private readonly cache: MarketDataCache;
  private feedConfigured = false;
  private readonly feedWaiters: Array<() => void> = [];

  constructor(
    private readonly options: {
      tokens: QuoteTokenSource;
      connect: (url: string) => DxlinkSocket;
      schedule: SessionSchedule;
      researchLimit?: number;
      eventTypes?: readonly FeedEventType[];
      onOutbound?: (frame: string) => void;
      onInbound?: (frame: string) => void;
    },
  ) {
    this.cache = new MarketDataCache({
      now: () => options.schedule.now(),
      marketClosed: (instant) => !isRegularUsEquitySession(instant),
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.open();
  }

  stop(): void {
    this.running = false;
    this.cancelKeepalive?.();
    this.cancelReconnect?.();
    this.socket?.close();
    this.socket = null;
    this.phase = 'idle';
  }

  subscribe(request: SubscriptionRequest): CachedSymbol {
    const limit = this.options.researchLimit ?? RESEARCH_LIMIT;
    const id = this.cache.normalize(request.instrumentId);
    if (request.purpose === 'research') {
      const research = [...this.consumers.values()].flatMap((items) => [...items.values()]).filter((item) => item.purpose === 'research');
      const already = research.some((item) => this.cache.normalize(item.instrumentId) === id);
      if (!already && new Set(research.map((item) => this.cache.normalize(item.instrumentId))).size >= limit) {
        throw new Error('Research subscription limit reached.');
      }
    }
    const bucket = this.consumers.get(request.consumerId) ?? new Map<string, SubscriptionRequest>();
    const symbolsBefore = new Set(this.activeSymbols());
    bucket.set(id, request);
    this.consumers.set(request.consumerId, bucket);
    this.cache.remember(id, request.streamerSymbol);
    if (request.streamerSymbol && !symbolsBefore.has(request.streamerSymbol)) this.pushSubscriptions(false);
    return this.read(id);
  }

  unsubscribe(consumerId: string, instrumentId?: string): void {
    const bucket = this.consumers.get(consumerId);
    if (!bucket) return;
    const ids = instrumentId ? [this.cache.normalize(instrumentId)] : [...bucket.keys()];
    const removed: string[] = [];
    for (const id of ids) {
      const request = bucket.get(id);
      bucket.delete(id);
      if (!request?.streamerSymbol) continue;
      if (!this.streamerStillUsed(request.streamerSymbol)) {
        removed.push(request.streamerSymbol);
        this.cache.forget(id);
      }
    }
    if (bucket.size === 0) this.consumers.delete(consumerId);
    if (removed.length > 0 && this.phase === 'feed') this.emit(removalFrame(removed, this.eventTypes()));
  }

  waitForFeed(timeoutMs: number): Promise<boolean> {
    if (this.feedConfigured) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.feedWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  snapshot(instrumentId: string): { freshness: SymbolFreshness; row: CachedSymbol | null; connection: 'connected' | 'disconnected' } {
    const row = this.cache.get(instrumentId);
    if (this.phase !== 'feed') {
      return { connection: 'disconnected', freshness: row?.quote || row?.greeks || row?.trade ? 'disconnected' : 'missing', row };
    }
    return { connection: 'connected', freshness: row?.freshness ?? 'missing', row };
  }

  private streamerStillUsed(streamerSymbol: string): boolean {
    return [...this.consumers.values()].some((bucket) => [...bucket.values()].some((item) => item.streamerSymbol === streamerSymbol));
  }

  private activeSymbols(): string[] {
    const symbols = new Set<string>();
    for (const bucket of this.consumers.values()) {
      for (const request of bucket.values()) {
        if (request.streamerSymbol) symbols.add(request.streamerSymbol);
      }
    }
    return [...symbols].sort();
  }

  private pushSubscriptions(reset: boolean): void {
    if (this.phase !== 'feed') return;
    const symbols = this.activeSymbols();
    if (symbols.length === 0) return;
    this.emit(subscriptionFrame(symbols, reset, this.eventTypes()));
  }

  private eventTypes(): readonly FeedEventType[] {
    return this.options.eventTypes ?? ['Quote', 'Trade', 'Greeks'];
  }

  private emit(frame: string): void {
    this.options.onOutbound?.(frame);
    this.socket?.send(frame);
  }

  private async open(): Promise<void> {
    let token = await this.options.tokens.getQuoteToken();
    if (token.expiresAt - this.options.schedule.now() < TOKEN_RENEW_MS) {
      token = await this.options.tokens.getQuoteToken();
    }
    assertDxlinkUrl(token.dxlinkUrl);
    this.phase = 'setup';
    const socket = this.options.connect(token.dxlinkUrl);
    this.socket = socket;
    socket.onMessage((frame) => this.onFrame(frame));
    socket.onClose(() => this.onSocketClose());
    this.emit(setupFrame());
    this.cancelKeepalive?.();
    this.cancelKeepalive = this.options.schedule.every(30_000, () => {
      if (this.phase === 'idle') return;
      this.emit(keepaliveFrame());
    });
  }

  private onFrame(frame: string): void {
    this.options.onInbound?.(frame);
    let message: { type?: string; state?: string; channel?: number };
    try {
      message = JSON.parse(frame) as { type?: string; state?: string; channel?: number };
    } catch {
      return;
    }
    if (message.type === 'AUTH_STATE' && message.state === 'UNAUTHORIZED' && this.phase === 'setup') {
      this.phase = 'auth';
      void this.sendAuth();
      return;
    }
    if (message.type === 'AUTH_STATE' && message.state === 'AUTHORIZED' && this.phase === 'auth') {
      this.phase = 'channel';
      this.emit(channelRequestFrame());
      return;
    }
    if (message.type === 'CHANNEL_OPENED' && message.channel === 3 && this.phase === 'channel') {
      this.emit(feedSetupFrame());
      return;
    }
    if (message.type === 'FEED_CONFIG' && this.phase === 'channel') {
      this.phase = 'feed';
      this.feedConfigured = true;
      this.attempt = 0;
      this.pushSubscriptions(true);
      for (const waiter of this.feedWaiters.splice(0)) waiter();
      return;
    }
    if (message.type === 'FEED_DATA' && this.phase === 'feed') {
      const receivedAt = new Date(this.options.schedule.now()).toISOString();
      for (const event of parseFeedData(JSON.parse(frame) as unknown)) {
        if (event.kind === 'quote') this.cache.applyQuote(event.quote, receivedAt);
        if (event.kind === 'trade') this.cache.applyTrade(event.trade, receivedAt);
        if (event.kind === 'greeks') this.cache.applyGreeks(event.greeks, receivedAt);
      }
    }
  }

  private async sendAuth(): Promise<void> {
    const token = await this.options.tokens.getQuoteToken();
    assertDxlinkUrl(token.dxlinkUrl);
    this.emit(authFrame(token.token));
  }

  private onSocketClose(): void {
    this.cancelKeepalive?.();
    this.socket = null;
    this.feedConfigured = false;
    this.phase = 'idle';
    if (!this.running) return;
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)] ?? 30000;
    this.attempt += 1;
    this.cancelReconnect = this.options.schedule.later(delay, () => {
      void this.open();
    });
  }

  private read(instrumentId: string): CachedSymbol {
    return this.snapshot(instrumentId).row ?? this.cache.remember(instrumentId, null);
  }
}

export function liveDxlinkSocket(): never {
  throw new Error('Live DXLink is disabled until an approved diagnostic.');
}
