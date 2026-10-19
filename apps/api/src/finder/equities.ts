import type { BrokerageReadClient } from '../brokerage/client.js';
import { TastytradeError } from '../brokerage/errors.js';

export interface ResolvedEquity {
  requestedSymbol: string;
  returnedSymbol: string;
  streamerSymbol: string;
}

export function equityPath(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed === '' || trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('Equity symbol is not valid.');
  }
  return `/instruments/equities/${encodeURIComponent(trimmed)}`;
}

export function parseEquityInstrument(requestedSymbol: string, payload: unknown): ResolvedEquity {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The equity instrument response did not match the requested symbol.');
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    throw new Error('The equity instrument response did not match the requested symbol.');
  }
  const record = data as Record<string, unknown>;
  const returnedSymbol = record.symbol;
  const streamerSymbol = record['streamer-symbol'];
  if (typeof returnedSymbol !== 'string' || typeof streamerSymbol !== 'string' || streamerSymbol.trim() === '') {
    throw new Error('The equity instrument response did not include a streamer symbol.');
  }
  if (returnedSymbol.trim().toUpperCase() !== requestedSymbol.trim().toUpperCase()) {
    throw new Error('The equity instrument response did not match the requested symbol.');
  }
  return {
    requestedSymbol: requestedSymbol.trim().toUpperCase(),
    returnedSymbol,
    streamerSymbol,
  };
}

export async function resolveEquityStreamer(client: BrokerageReadClient, symbol: string): Promise<ResolvedEquity> {
  const ticker = symbol.trim().toUpperCase();
  try {
    const payload = await client.getJson(equityPath(ticker));
    return parseEquityInstrument(ticker, payload);
  } catch (error) {
    if (error instanceof TastytradeError) {
      if (error.status === 404) {
        throw new Error(
          `${ticker} is not supported by the brokerage equity lookup (HTTP 404). Live Smart Scan does not use simulated data.`,
        );
      }
      throw new Error(`Equity instrument lookup failed for ${ticker} with HTTP ${error.status}.`);
    }
    throw error;
  }
}