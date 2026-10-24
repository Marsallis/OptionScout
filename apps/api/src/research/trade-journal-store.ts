import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  estimatedJournalPnl,
  summarizeJournal,
  tradeJournalEntrySchema,
  tradeJournalWriteSchema,
  type TradeJournalEntry,
  type TradeJournalSummary,
  type TradeJournalWrite,
} from '@optionscout/shared';
import type { AppDatabase } from '../db/client.js';
import { tradeJournal } from '../db/schema.js';
import { HttpError } from '../http.js';

function toEntry(row: typeof tradeJournal.$inferSelect): TradeJournalEntry {
  const tags = JSON.parse(row.tags) as unknown;
  return tradeJournalEntrySchema.parse({
    id: row.id,
    entryDate: row.entryDate,
    ticker: row.ticker,
    strategy: row.strategy,
    entryPremium: row.entryPremium,
    exitPremium: row.exitPremium,
    notes: row.notes,
    tags,
    outcome: row.outcome,
    estimatedPnl: estimatedJournalPnl(row.entryPremium, row.exitPremium),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function normalizeWrite(input: unknown): TradeJournalWrite {
  const parsed = tradeJournalWriteSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, 'Journal entry is missing a date, ticker, strategy, premium, or outcome.');
  }
  return {
    ...parsed.data,
    ticker: parsed.data.ticker.toUpperCase(),
    tags: parsed.data.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
  };
}

export function listTradeJournal(db: AppDatabase): { entries: TradeJournalEntry[]; summary: TradeJournalSummary } {
  const entries = db.select().from(tradeJournal).all().map(toEntry).sort((left, right) => right.entryDate.localeCompare(left.entryDate) || right.createdAt.localeCompare(left.createdAt));
  return { entries, summary: summarizeJournal(entries) };
}

export function createTradeJournalEntry(db: AppDatabase, input: unknown): TradeJournalEntry {
  const write = normalizeWrite(input);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    entryDate: write.entryDate,
    ticker: write.ticker,
    strategy: write.strategy,
    entryPremium: write.entryPremium,
    exitPremium: write.exitPremium,
    notes: write.notes,
    tags: JSON.stringify(write.tags),
    outcome: write.outcome,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(tradeJournal).values(row).run();
  return toEntry(row);
}

export function updateTradeJournalEntry(db: AppDatabase, id: string, input: unknown): TradeJournalEntry {
  const existing = db.select().from(tradeJournal).where(eq(tradeJournal.id, id)).all()[0];
  if (!existing) throw new HttpError(404, 'Journal entry was not found.');
  const write = normalizeWrite(input);
  const updatedAt = new Date().toISOString();
  const row = {
    ...existing,
    entryDate: write.entryDate,
    ticker: write.ticker,
    strategy: write.strategy,
    entryPremium: write.entryPremium,
    exitPremium: write.exitPremium,
    notes: write.notes,
    tags: JSON.stringify(write.tags),
    outcome: write.outcome,
    updatedAt,
  };
  db.update(tradeJournal).set(row).where(eq(tradeJournal.id, id)).run();
  return toEntry(row);
}

export function deleteTradeJournalEntry(db: AppDatabase, id: string): void {
  const existing = db.select().from(tradeJournal).where(eq(tradeJournal.id, id)).all()[0];
  if (!existing) throw new HttpError(404, 'Journal entry was not found.');
  db.delete(tradeJournal).where(eq(tradeJournal.id, id)).run();
}
