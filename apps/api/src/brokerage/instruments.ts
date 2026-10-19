import { eq } from 'drizzle-orm';
import type { BrokerageReadClient } from './client.js';
import { TastytradeError } from './errors.js';
import type { AppDatabase } from '../db/client.js';
import { instrumentSymbols } from '../db/schema.js';

export interface ResolvedInstrument {
  requestedSymbol: string;
  returnedSymbol: string;
  streamerSymbol: string;
  underlyingSymbol: string;
}

export interface UnresolvedInstrument {
  requestedSymbol: string;
  reason: string;
}

export function equityOptionPath(symbol: string): string {
  const trimmed = symbol.trim();
  if (trimmed === '' || trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('Instrument symbol is not valid.');
  }
  return `/instruments/equity-options/${encodeURIComponent(symbol)}`;
}

function compact(symbol: string): string {
  return symbol.trim().replace(/\s+/g, '');
}

export function parseEquityOption(requestedSymbol: string, payload: unknown): ResolvedInstrument {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The instrument response did not match the requested contract.');
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    throw new Error('The instrument response did not match the requested contract.');
  }
  const record = data as Record<string, unknown>;
  const returnedSymbol = record.symbol;
  const streamerSymbol = record['streamer-symbol'];
  const underlyingSymbol = record['underlying-symbol'];
  if (typeof returnedSymbol !== 'string' || typeof streamerSymbol !== 'string' || streamerSymbol.trim() === '') {
    throw new Error('The instrument response did not include a streamer symbol.');
  }
  if (compact(returnedSymbol) !== compact(requestedSymbol)) {
    throw new Error('The instrument response did not match the requested contract.');
  }
  if (typeof underlyingSymbol !== 'string' || underlyingSymbol.trim() === '') {
    throw new Error('The instrument response did not match the requested contract.');
  }
  return {
    requestedSymbol,
    returnedSymbol,
    streamerSymbol,
    underlyingSymbol,
  };
}

export function saveInstrumentSymbol(db: AppDatabase, instrument: ResolvedInstrument, resolvedAt: string): void {
  db.insert(instrumentSymbols)
    .values({
      requestedSymbol: instrument.requestedSymbol,
      returnedSymbol: instrument.returnedSymbol,
      streamerSymbol: instrument.streamerSymbol,
      underlyingSymbol: instrument.underlyingSymbol,
      resolvedAt,
    })
    .onConflictDoUpdate({
      target: instrumentSymbols.requestedSymbol,
      set: {
        returnedSymbol: instrument.returnedSymbol,
        streamerSymbol: instrument.streamerSymbol,
        underlyingSymbol: instrument.underlyingSymbol,
        resolvedAt,
      },
    })
    .run();
}

export async function resolveEquityOption(client: BrokerageReadClient, requestedSymbol: string): Promise<ResolvedInstrument> {
  const payload = await client.getJson(equityOptionPath(requestedSymbol));
  return parseEquityOption(requestedSymbol, payload);
}

export async function resolveEquityOptions(
  client: BrokerageReadClient,
  db: AppDatabase,
  symbols: readonly string[],
  resolvedAt: string,
): Promise<{ resolved: ResolvedInstrument[]; unresolved: UnresolvedInstrument[] }> {
  const resolved: ResolvedInstrument[] = [];
  const unresolved: UnresolvedInstrument[] = [];
  for (const requestedSymbol of symbols) {
    try {
      const instrument = await resolveEquityOption(client, requestedSymbol);
      saveInstrumentSymbol(db, instrument, resolvedAt);
      resolved.push(instrument);
    } catch (error) {
      const reason = error instanceof TastytradeError ? `Instrument lookup failed with HTTP ${error.status}.` : 'The instrument response did not match the requested contract.';
      unresolved.push({ requestedSymbol, reason });
      db.delete(instrumentSymbols).where(eq(instrumentSymbols.requestedSymbol, requestedSymbol)).run();
    }
  }
  return { resolved, unresolved };
}
