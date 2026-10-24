import { demoChainSchema, tradeJournalEntrySchema, tradeJournalListSchema } from '@optionscout/shared';
import type { Express, Request, Response } from 'express';
import type { AppContext } from '../context.js';
import { buildDemoChain } from './demo-chain-view.js';
import { createTradeJournalEntry, deleteTradeJournalEntry, listTradeJournal, updateTradeJournalEntry } from './trade-journal-store.js';

export function registerDeskRoutes(
  app: Express,
  context: AppContext,
  authorize: (req: Request) => void,
  sendKnownError: (res: Response, error: unknown) => boolean,
): void {
  app.get('/api/research/demo-chain', async (_req, res, next) => {
    try {
      res.json(demoChainSchema.parse(await buildDemoChain()));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/journal', (req, res, next) => {
    try {
      authorize(req);
      res.json(tradeJournalListSchema.parse(listTradeJournal(context.database.db)));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/journal', (req, res, next) => {
    try {
      authorize(req);
      const created = createTradeJournalEntry(context.database.db, req.body);
      res.status(201).json(tradeJournalEntrySchema.parse(created));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.put('/api/journal/:id', (req, res, next) => {
    try {
      authorize(req);
      const updated = updateTradeJournalEntry(context.database.db, String(req.params.id), req.body);
      res.json(tradeJournalEntrySchema.parse(updated));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/journal/:id', (req, res, next) => {
    try {
      authorize(req);
      deleteTradeJournalEntry(context.database.db, String(req.params.id));
      res.status(204).end();
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });
}
