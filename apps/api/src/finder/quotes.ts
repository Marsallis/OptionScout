export interface FinderQuoteSnapshot {
  streamerSymbol: string;
  bid: string | null;
  ask: string | null;
  mark: string | null;
  delta: string | null;
  theta: string | null;
  gamma: string | null;
  vega: string | null;
  impliedVolatility: string | null;
  volume: number | null;
  openInterest: number | null;
  /** Provider event timestamp when the feed supplies one. Never invent from local receipt time. */
  providerEventAt: string | null;
  greekEventAt: string | null;
  receivedAt: string;
  sourceLabel: string;
  /** True when any displayed field was filled from durable last-known cache. */
  fromCache?: boolean;
  observationFreshness?: 'current-session' | 'previous-session' | 'older' | 'unavailable';
}

/** One stock-price observation paired with option quotes during a research operation. */
export interface UnderlyingObservation {
  price: string;
  quoteAt: string;
  bid: string | null;
  ask: string | null;
}

export interface FinderQuoteSource {
  /** Fetch quotes for a batch of streamer symbols. Implementations must not fabricate missing fields. */
  fetchQuotes(streamerSymbols: readonly string[]): Promise<Map<string, FinderQuoteSnapshot>>;
}

export function emptyQuoteMap(streamerSymbols: readonly string[], receivedAt: string, sourceLabel: string): Map<string, FinderQuoteSnapshot> {
  const map = new Map<string, FinderQuoteSnapshot>();
  for (const streamerSymbol of streamerSymbols) {
    map.set(streamerSymbol, {
      streamerSymbol,
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
      sourceLabel,
    });
  }
  return map;
}
