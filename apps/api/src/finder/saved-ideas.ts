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

function occ(value: string, label: string): string {
  const ticker = value.trim().toUpperCase();
  if (ticker.length < 10 || ticker.length > 32 || /[\r\n\0]/.test(ticker)) {
    throw new SavedIdeaError(`${label} is not a contract symbol.`);
  }
  return ticker;
}

export function listSavedIdeas(db: AppDatabase) {
  return db.select().from(savedPmccIdeas).all().map((row) => ({
    id: row.id,
    kind: row.shortOcc ? 'pmcc-setup' as const : 'leaps-idea' as const,
    underlying: row.underlying,
    longOcc: row.longOcc,
    shortOcc: row.shortOcc,
    profileId: row.profileId,
    profileRevision: row.profileRevision,
    sessionId: row.sessionId,
    quoteAsOf: row.quoteAsOf,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hypothetical: true as const,
  }));
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
  const longOcc = occ(input.longOcc, 'Long contract');
  const shortOcc = input.shortOcc?.trim() ? occ(input.shortOcc, 'Short contract') : null;
  if (shortOcc && shortOcc === longOcc) throw new SavedIdeaError('The short contract must be a different contract from the long LEAPS.');
  const now = new Date().toISOString();
  const id = randomUUID();
  db.insert(savedPmccIdeas).values({
    id,
    underlying,
    longOcc,
    shortOcc,
    profileId: input.profileId ?? null,
    profileRevision: input.profileRevision ?? null,
    sessionId: input.sessionId ?? null,
    quoteAsOf: input.quoteAsOf ?? null,
    notes: (input.notes ?? '').slice(0, 500),
    longSnapshotJson: JSON.stringify({ occ: longOcc, savedAt: now }),
    shortSnapshotJson: shortOcc ? JSON.stringify({ occ: shortOcc, savedAt: now }) : null,
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
