/**
 * SQLite-backed last-known market observations for Finder / Smart Scan.
 * Field-level merge: newer provider timestamps win per field; omissions never wipe valid older values.
 * Local receipt time is never used as a fictional market event time.
 */

import { eq } from 'drizzle-orm';
import { isRegularUsEquitySession } from '../brokerage/market-hours.js';
import type { AppDatabase } from '../db/client.js';
import { marketDataObservations } from '../db/schema.js';
import type { FinderQuoteSnapshot } from './quotes.js';

export type ObservationFreshness = 'current-session' | 'previous-session' | 'older' | 'unavailable';
export type GreekVerification = 'aligned' | 'historical-unverified' | 'unavailable';

export const OBSERVATION_RETENTION_DAYS = 14;
export const OBSERVATION_MAX_ROWS = 5000;
/** Max age (ms) between quote and greek provider events for classification alignment. */
export const GREEK_QUOTE_ALIGN_MS = 60_000;

export interface ObservationRow {
  id: string;
  instrumentKind: 'equity' | 'equity-option';
  underlying: string;
  occSymbol: string | null;
  streamerSymbol: string;
  bid: string | null;
  ask: string | null;
  mark: string | null;
  lastPrice: string | null;
  delta: string | null;
  theta: string | null;
  gamma: string | null;
  vega: string | null;
  impliedVolatility: string | null;
  volume: number | null;
  openInterest: number | null;
  quoteProviderEventAt: string | null;
  greekProviderEventAt: string | null;
  underlyingProviderEventAt: string | null;
  quoteReceivedAt: string | null;
  greekReceivedAt: string | null;
  source: string;
  sessionAtQuote: string | null;
  entitlement: string | null;
  updatedAt: string;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function nyDateKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function newerIso(incoming: string | null | undefined, existing: string | null | undefined): boolean {
  if (!incoming) return false;
  if (!existing) return true;
  const a = Date.parse(incoming);
  const b = Date.parse(existing);
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a >= b;
}

export function classifyObservationFreshness(providerEventAt: string | null, now: Date): ObservationFreshness {
  if (!providerEventAt) return 'unavailable';
  const event = new Date(providerEventAt);
  if (Number.isNaN(event.getTime())) return 'unavailable';
  const ageMs = now.getTime() - event.getTime();
  if (ageMs < 0) return 'current-session';
  const sameDay = nyDateKey(event) === nyDateKey(now);
  const eventRegular = isRegularUsEquitySession(event);
  const nowRegular = isRegularUsEquitySession(now);
  if (sameDay && eventRegular && nowRegular && ageMs <= 15 * 60 * 1000) return 'current-session';
  if (sameDay) return 'previous-session';
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 'previous-session';
  return 'older';
}

export function assessGreekVerification(input: {
  quoteProviderEventAt: string | null;
  greekProviderEventAt: string | null;
  delta: string | null;
  now: Date;
  alignMs?: number;
}): GreekVerification {
  if (input.delta == null || !input.greekProviderEventAt) return 'unavailable';
  if (!input.quoteProviderEventAt) return 'historical-unverified';
  const quoteMs = Date.parse(input.quoteProviderEventAt);
  const greekMs = Date.parse(input.greekProviderEventAt);
  if (Number.isNaN(quoteMs) || Number.isNaN(greekMs)) return 'historical-unverified';
  const align = input.alignMs ?? GREEK_QUOTE_ALIGN_MS;
  if (Math.abs(greekMs - quoteMs) > align) return 'historical-unverified';
  const quoteFresh = classifyObservationFreshness(input.quoteProviderEventAt, input.now);
  const greekFresh = classifyObservationFreshness(input.greekProviderEventAt, input.now);
  if (quoteFresh === 'current-session' && greekFresh !== 'current-session') return 'historical-unverified';
  if (quoteFresh === 'unavailable' || greekFresh === 'unavailable') return 'historical-unverified';
  return 'aligned';
}

function observationId(streamerSymbol: string, kind: string): string {
  return `mdo_${kind}_${streamerSymbol.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function rowFromDb(row: typeof marketDataObservations.$inferSelect): ObservationRow {
  return {
    id: row.id,
    instrumentKind: row.instrumentKind === 'equity' ? 'equity' : 'equity-option',
    underlying: row.underlying,
    occSymbol: row.occSymbol,
    streamerSymbol: row.streamerSymbol,
    bid: row.bid,
    ask: row.ask,
    mark: row.mark,
    lastPrice: row.lastPrice,
    delta: row.delta,
    theta: row.theta,
    gamma: row.gamma,
    vega: row.vega,
    impliedVolatility: row.impliedVolatility,
    volume: row.volume,
    openInterest: row.openInterest,
    quoteProviderEventAt: row.quoteProviderEventAt,
    greekProviderEventAt: row.greekProviderEventAt,
    underlyingProviderEventAt: row.underlyingProviderEventAt,
    quoteReceivedAt: row.quoteReceivedAt,
    greekReceivedAt: row.greekReceivedAt,
    source: row.source,
    sessionAtQuote: row.sessionAtQuote,
    entitlement: row.entitlement,
    updatedAt: row.updatedAt,
  };
}

export function getObservationByStreamer(db: AppDatabase, streamerSymbol: string): ObservationRow | null {
  const rows = db
    .select()
    .from(marketDataObservations)
    .where(eq(marketDataObservations.streamerSymbol, streamerSymbol))
    .all();
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export function pruneObservations(db: AppDatabase, now = new Date()): void {
  const cutoff = new Date(now.getTime() - OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const all = db.select().from(marketDataObservations).all();
  for (const row of all) {
    if (row.updatedAt < cutoff) {
      db.delete(marketDataObservations).where(eq(marketDataObservations.id, row.id)).run();
    }
  }
  const remaining = db.select().from(marketDataObservations).all().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const overflow = remaining.length - OBSERVATION_MAX_ROWS;
  if (overflow > 0) {
    for (const row of remaining.slice(0, overflow)) {
      db.delete(marketDataObservations).where(eq(marketDataObservations.id, row.id)).run();
    }
  }
}

/**
 * Merge provider snapshot into durable storage. Never overwrites a field with an older provider event.
 * Receipt timestamps are stored separately and never substituted for provider event times.
 */
export function upsertObservationFromSnapshot(
  db: AppDatabase,
  input: {
    snapshot: FinderQuoteSnapshot;
    instrumentKind: 'equity' | 'equity-option';
    underlying: string;
    occSymbol?: string | null;
    underlyingProviderEventAt?: string | null;
    now?: Date;
  },
): ObservationRow {
  const now = input.now ?? new Date();
  const updatedAt = nowIso(now);
  const streamer = input.snapshot.streamerSymbol;
  const id = observationId(streamer, input.instrumentKind);
  const existing = getObservationByStreamer(db, streamer);
  const snap = input.snapshot;

  const quoteEvent = snap.providerEventAt;
  const greekEvent = snap.greekEventAt;
  const canWriteQuote = newerIso(quoteEvent, existing?.quoteProviderEventAt) || (!existing?.ask && snap.ask != null);
  const canWriteGreek = newerIso(greekEvent, existing?.greekProviderEventAt) || (!existing?.delta && snap.delta != null);

  const merged: ObservationRow = {
    id,
    instrumentKind: input.instrumentKind,
    underlying: input.underlying,
    occSymbol: input.occSymbol ?? existing?.occSymbol ?? null,
    streamerSymbol: streamer,
    bid: canWriteQuote && snap.bid != null ? snap.bid : (existing?.bid ?? snap.bid),
    ask: canWriteQuote && snap.ask != null ? snap.ask : (existing?.ask ?? snap.ask),
    mark: canWriteQuote && snap.mark != null ? snap.mark : (existing?.mark ?? snap.mark),
    lastPrice: existing?.lastPrice ?? null,
    delta: canWriteGreek && snap.delta != null ? snap.delta : (existing?.delta ?? snap.delta),
    theta: canWriteGreek && snap.theta != null ? snap.theta : (existing?.theta ?? snap.theta),
    gamma: canWriteGreek && snap.gamma != null ? snap.gamma : (existing?.gamma ?? snap.gamma),
    vega: canWriteGreek && snap.vega != null ? snap.vega : (existing?.vega ?? snap.vega),
    impliedVolatility:
      canWriteGreek && snap.impliedVolatility != null
        ? snap.impliedVolatility
        : (existing?.impliedVolatility ?? snap.impliedVolatility),
    volume: canWriteQuote && snap.volume != null ? snap.volume : (existing?.volume ?? snap.volume),
    openInterest: canWriteQuote && snap.openInterest != null ? snap.openInterest : (existing?.openInterest ?? snap.openInterest),
    quoteProviderEventAt: canWriteQuote && quoteEvent ? quoteEvent : (existing?.quoteProviderEventAt ?? quoteEvent),
    greekProviderEventAt: canWriteGreek && greekEvent ? greekEvent : (existing?.greekProviderEventAt ?? greekEvent),
    underlyingProviderEventAt: newerIso(input.underlyingProviderEventAt, existing?.underlyingProviderEventAt)
      ? (input.underlyingProviderEventAt ?? null)
      : (existing?.underlyingProviderEventAt ?? input.underlyingProviderEventAt ?? null),
    quoteReceivedAt: canWriteQuote ? snap.receivedAt : (existing?.quoteReceivedAt ?? snap.receivedAt),
    greekReceivedAt: canWriteGreek && snap.delta != null ? snap.receivedAt : (existing?.greekReceivedAt ?? null),
    source: snap.sourceLabel || existing?.source || 'provider',
    sessionAtQuote: quoteEvent
      ? isRegularUsEquitySession(new Date(quoteEvent))
        ? 'regular'
        : 'closed'
      : (existing?.sessionAtQuote ?? null),
    entitlement: existing?.entitlement ?? null,
    updatedAt,
  };

  if (existing) {
    db.update(marketDataObservations)
      .set({
        underlying: merged.underlying,
        occSymbol: merged.occSymbol,
        bid: merged.bid,
        ask: merged.ask,
        mark: merged.mark,
        lastPrice: merged.lastPrice,
        delta: merged.delta,
        theta: merged.theta,
        gamma: merged.gamma,
        vega: merged.vega,
        impliedVolatility: merged.impliedVolatility,
        volume: merged.volume,
        openInterest: merged.openInterest,
        quoteProviderEventAt: merged.quoteProviderEventAt,
        greekProviderEventAt: merged.greekProviderEventAt,
        underlyingProviderEventAt: merged.underlyingProviderEventAt,
        quoteReceivedAt: merged.quoteReceivedAt,
        greekReceivedAt: merged.greekReceivedAt,
        source: merged.source,
        sessionAtQuote: merged.sessionAtQuote,
        entitlement: merged.entitlement,
        updatedAt: merged.updatedAt,
      })
      .where(eq(marketDataObservations.id, id))
      .run();
  } else {
    db.insert(marketDataObservations)
      .values({
        id: merged.id,
        instrumentKind: merged.instrumentKind,
        underlying: merged.underlying,
        occSymbol: merged.occSymbol,
        streamerSymbol: merged.streamerSymbol,
        bid: merged.bid,
        ask: merged.ask,
        mark: merged.mark,
        lastPrice: merged.lastPrice,
        delta: merged.delta,
        theta: merged.theta,
        gamma: merged.gamma,
        vega: merged.vega,
        impliedVolatility: merged.impliedVolatility,
        volume: merged.volume,
        openInterest: merged.openInterest,
        quoteProviderEventAt: merged.quoteProviderEventAt,
        greekProviderEventAt: merged.greekProviderEventAt,
        underlyingProviderEventAt: merged.underlyingProviderEventAt,
        quoteReceivedAt: merged.quoteReceivedAt,
        greekReceivedAt: merged.greekReceivedAt,
        source: merged.source,
        sessionAtQuote: merged.sessionAtQuote,
        entitlement: merged.entitlement,
        updatedAt: merged.updatedAt,
      })
      .run();
  }
  pruneObservations(db, now);
  return merged;
}

/** Build a Finder quote snapshot from cache when live fields are missing. */
export function snapshotFromObservation(row: ObservationRow, receivedAt: string): FinderQuoteSnapshot {
  const freshness = classifyObservationFreshness(row.quoteProviderEventAt, new Date(receivedAt));
  const label =
    freshness === 'previous-session'
      ? `Last-known previous-session cache (${row.source})`
      : freshness === 'older'
        ? `Older cached observation (${row.source})`
        : `Cached observation (${row.source})`;
  return {
    streamerSymbol: row.streamerSymbol,
    bid: row.bid,
    ask: row.ask,
    mark: row.mark,
    delta: row.delta,
    theta: row.theta,
    gamma: row.gamma,
    vega: row.vega,
    impliedVolatility: row.impliedVolatility,
    volume: row.volume,
    openInterest: row.openInterest,
    providerEventAt: row.quoteProviderEventAt,
    greekEventAt: row.greekProviderEventAt,
    receivedAt,
    sourceLabel: label,
    fromCache: true,
    observationFreshness: freshness,
  };
}

export function mergeLiveWithCache(
  live: FinderQuoteSnapshot | null,
  cached: ObservationRow | null,
  now: Date,
): FinderQuoteSnapshot | null {
  if (!live && !cached) return null;
  if (!cached) {
    return live
      ? {
          ...live,
          fromCache: false,
          observationFreshness: classifyObservationFreshness(live.providerEventAt, now),
        }
      : null;
  }
  if (!live) return snapshotFromObservation(cached, nowIso(now));

  const ask = live.ask ?? cached.ask;
  const bid = live.bid ?? cached.bid;
  const mark = live.mark ?? cached.mark;
  const usedCacheQuote = live.ask == null && cached.ask != null;
  const delta = live.delta ?? cached.delta;
  const usedCacheGreek = live.delta == null && cached.delta != null;
  const providerEventAt = live.providerEventAt ?? cached.quoteProviderEventAt;
  const greekEventAt = live.greekEventAt ?? cached.greekProviderEventAt;
  const freshness = classifyObservationFreshness(providerEventAt, now);
  const parts = [live.sourceLabel];
  if (usedCacheQuote) parts.push('ask from last-known cache');
  if (usedCacheGreek) parts.push('Greeks from last-known cache');

  return {
    streamerSymbol: live.streamerSymbol,
    bid,
    ask,
    mark,
    delta,
    theta: live.theta ?? cached.theta,
    gamma: live.gamma ?? cached.gamma,
    vega: live.vega ?? cached.vega,
    impliedVolatility: live.impliedVolatility ?? cached.impliedVolatility,
    volume: live.volume ?? cached.volume,
    openInterest: live.openInterest ?? cached.openInterest,
    providerEventAt,
    greekEventAt,
    receivedAt: live.receivedAt,
    sourceLabel: parts.join(' · '),
    fromCache: usedCacheQuote || usedCacheGreek,
    observationFreshness: freshness,
  };
}
