import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { savedPmccIdeas } from '../db/schema.js';

export class SavedIdeaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavedIdeaError';
  }
}

const OCC = /^([A-Z]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

function parsedContract(value: string, label: string): { symbol: string; root: string; expiration: string; right: 'C' | 'P'; strikeCode: number } {
  const symbol = value.trim().toUpperCase();
  const match = OCC.exec(symbol);
  if (!match || /[\r\n\0]/.test(value)) {
    throw new SavedIdeaError(`${label} is not a supported option symbol. Use the contract symbol from the research result, such as ZZT   280121C00155000.`);
  }
  const root = match[1] ?? '';
  const year = match[2] ?? '';
  const month = match[3] ?? '';
  const day = match[4] ?? '';
  const right = match[5] === 'P' ? 'P' : 'C';
  return { symbol, root, expiration: `20${year}-${month}-${day}`, right, strikeCode: Number(match[6] ?? '0') };
}

function describedIdea(longOcc: string, shortOcc: string | null): { kind: 'pmcc-setup' | 'leaps-idea' | 'reviewed-pair'; structureNote: string } {
  if (!shortOcc) {
    return {
      kind: 'leaps-idea',
      structureNote: 'Hypothetical only. Delta, intrinsic value, and profitability were not evaluated.',
    };
  }
  const long = parsedContract(longOcc, 'Long contract');
  const short = parsedContract(shortOcc, 'Short contract');
  if (long.strikeCode < short.strikeCode) {
    return {
      kind: 'pmcc-setup',
      structureNote: 'The long strike is below the short strike. This label is not a delta, intrinsic-value, or profitability check.',
    };
  }
  return {
    kind: 'reviewed-pair',
    structureNote: 'The long strike is not below the short strike, so this is not a conventional PMCC. Delta, intrinsic value, and profitability were not evaluated.',
  };
}

export function listSavedIdeas(db: AppDatabase) {
  return db.select().from(savedPmccIdeas).all().map((row) => {
    const described = describedIdea(row.longOcc, row.shortOcc);
    return {
    id: row.id,
    kind: described.kind,
    underlying: row.underlying,
    longOcc: row.longOcc,
    shortOcc: row.shortOcc,
    profileId: row.profileId,
    profileRevision: row.profileRevision,
    sessionId: row.sessionId,
    quoteAsOf: row.quoteAsOf,
    notes: row.notes,
    structureNote: described.structureNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hypothetical: true as const,
    notACurrentQuote: true as const,
  };
  });
}

export function createSavedIdea(db: AppDatabase, input: {
  underlying: string;
  longOcc: string;
  shortOcc?: string | null;
  profileId?: string | null;
  profileRevision?: number | null;
  sessionId?: string | null;
  quoteAsOf?: string | null;
  notes?: string;
}): ReturnType<typeof listSavedIdeas>[number] {
  const underlying = input.underlying.trim().toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(underlying)) throw new SavedIdeaError('Underlying symbol is not usable.');
  const long = parsedContract(input.longOcc, 'Long contract');
  if (long.root !== underlying) throw new SavedIdeaError('The long contract does not match the underlying symbol.');
  if (long.right !== 'C') throw new SavedIdeaError('The long contract must be a call.');
  const short = input.shortOcc?.trim() ? parsedContract(input.shortOcc, 'Short contract') : null;
  if (short) {
    if (short.root !== underlying) throw new SavedIdeaError('The short contract does not match the underlying symbol. OptionScout does not pair contracts by ticker alone.');
    if (short.right !== 'C') throw new SavedIdeaError('The proposed short contract must be a call.');
    if (short.symbol === long.symbol) throw new SavedIdeaError('The short contract must be a different contract from the long LEAPS.');
    if (short.expiration >= long.expiration) throw new SavedIdeaError('The proposed short call must expire before the long LEAPS.');
  }
  const now = new Date().toISOString();
  const provenance = {
    source: 'owner-entered',
    hypothetical: true,
    notACurrentQuote: true,
    savedAt: now,
    quoteAsOf: input.quoteAsOf ?? null,
    sessionId: input.sessionId ?? null,
    profileId: input.profileId ?? null,
    profileRevision: input.profileRevision ?? null,
  };
  const id = randomUUID();
  db.insert(savedPmccIdeas).values({
    id,
    underlying,
    longOcc: long.symbol,
    shortOcc: short?.symbol ?? null,
    profileId: input.profileId ?? null,
    profileRevision: input.profileRevision ?? null,
    sessionId: input.sessionId ?? null,
    quoteAsOf: input.quoteAsOf ?? null,
    notes: (input.notes ?? '').slice(0, 500),
    longSnapshotJson: JSON.stringify({ ...provenance, occ: long.symbol, expiration: long.expiration, right: 'call' }),
    shortSnapshotJson: short ? JSON.stringify({ ...provenance, occ: short.symbol, expiration: short.expiration, right: 'call' }) : null,
    createdAt: now,
    updatedAt: now,
  }).run();
  const saved = listSavedIdeas(db).find((row) => row.id === id);
  if (!saved) throw new SavedIdeaError('The idea could not be saved.');
  return saved;
}

export function deleteSavedIdea(db: AppDatabase, id: string): void {
  const existing = db.select().from(savedPmccIdeas).where(eq(savedPmccIdeas.id, id)).get();
  if (!existing) throw new SavedIdeaError('That saved idea was not found.');
  db.delete(savedPmccIdeas).where(eq(savedPmccIdeas.id, id)).run();
}
