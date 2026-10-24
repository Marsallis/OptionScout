import { z } from 'zod';
import { isoDateSchema } from './schemas.js';

export const tradeJournalOutcomeSchema = z.enum(['open', 'win', 'loss', 'scratch']);

const premiumSchema = z.string().regex(/^\d+\.\d{2}$/);

export const tradeJournalWriteSchema = z
  .object({
    entryDate: isoDateSchema,
    ticker: z.string().trim().min(1).max(6),
    strategy: z.string().trim().min(1).max(80),
    entryPremium: premiumSchema,
    exitPremium: premiumSchema.nullable(),
    notes: z.string().max(2000),
    tags: z.array(z.string().trim().min(1).max(32)).max(12),
    outcome: tradeJournalOutcomeSchema,
  })
  .strict();

export const tradeJournalEntrySchema = tradeJournalWriteSchema.extend({
  id: z.string().min(1),
  estimatedPnl: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const tradeJournalSummarySchema = z
  .object({
    count: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    scratch: z.number().int().nonnegative(),
    winRate: z.string().nullable(),
    totalEstimatedPnl: z.string(),
  })
  .strict();

export const tradeJournalListSchema = z
  .object({
    entries: z.array(tradeJournalEntrySchema),
    summary: tradeJournalSummarySchema,
  })
  .strict();

export type TradeJournalWrite = z.infer<typeof tradeJournalWriteSchema>;
export type TradeJournalEntry = z.infer<typeof tradeJournalEntrySchema>;
export type TradeJournalSummary = z.infer<typeof tradeJournalSummarySchema>;

export function estimatedJournalPnl(entryPremium: string, exitPremium: string | null): string | null {
  if (exitPremium == null) return null;
  const entry = Number(entryPremium);
  const exit = Number(exitPremium);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  return ((exit - entry) * 100).toFixed(2);
}

export function summarizeJournal(entries: readonly TradeJournalEntry[]): TradeJournalSummary {
  const wins = entries.filter((entry) => entry.outcome === 'win').length;
  const losses = entries.filter((entry) => entry.outcome === 'loss').length;
  const decided = wins + losses;
  const total = entries.reduce((sum, entry) => sum + Number(entry.estimatedPnl ?? 0), 0);
  return {
    count: entries.length,
    wins,
    losses,
    open: entries.filter((entry) => entry.outcome === 'open').length,
    scratch: entries.filter((entry) => entry.outcome === 'scratch').length,
    winRate: decided === 0 ? null : ((wins / decided) * 100).toFixed(1),
    totalEstimatedPnl: total.toFixed(2),
  };
}
