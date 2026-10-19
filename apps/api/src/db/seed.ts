import { eq } from 'drizzle-orm';
import {
  account,
  alerts,
  DEMO_SEED_VERSION,
  journalEntries,
  legs,
  marks,
  positions,
  researchCandidates,
  transactions,
  watchlist,
} from '../demo/fixtures.js';
import type { AppDatabase } from './client.js';
import {
  accounts,
  alerts as alertsTable,
  appMeta,
  journalEntries as journalTable,
  marks as marksTable,
  optionLegs,
  positions as positionsTable,
  researchCandidates as researchTable,
  transactions as transactionsTable,
  watchlistItems,
} from './schema.js';

export function seedDemoFixtures(db: AppDatabase): boolean {
  const existing = db.select().from(appMeta).where(eq(appMeta.key, 'demo_seed_version')).get();
  if (existing?.value === DEMO_SEED_VERSION) {
    const note = researchCandidates.find((item) => item.id === 'res_googl');
    if (note) {
      db.update(researchTable).set({ criteriaNote: note.criteriaNote }).where(eq(researchTable.id, note.id)).run();
    }
    return false;
  }
  if (existing) {
    throw new Error(`Unsupported demo seed version ${existing.value}. Refusing to mix fixture generations.`);
  }

  db.transaction((tx) => {
    tx.insert(accounts)
      .values({
        id: account.id,
        provider: account.provider,
        externalId: account.externalId,
        displayName: account.displayName,
        isDemo: account.isDemo,
        connectionStatus: account.connectionStatus,
        createdAt: account.createdAt,
      })
      .run();

    for (const position of positions) {
      tx.insert(positionsTable).values(position).run();
    }
    for (const leg of legs) {
      tx.insert(optionLegs)
        .values({
          id: leg.id,
          positionId: leg.positionId,
          side: leg.side,
          optionType: leg.optionType,
          strike: leg.strike,
          expiration: leg.expiration,
          quantity: leg.quantity,
          openPremium: leg.openPremium,
          status: leg.status,
          instrumentKey: leg.instrumentKey,
          tastySymbol: leg.tastySymbol,
          openedOn: leg.openedOn,
          closedOn: leg.closedOn,
          isDemo: leg.isDemo,
        })
        .run();
    }
    for (const transaction of transactions) {
      tx.insert(transactionsTable).values(transaction).run();
    }
    for (const mark of marks) {
      tx.insert(marksTable).values(mark).run();
    }
    for (const entry of journalEntries) {
      tx.insert(journalTable).values(entry).run();
    }
    for (const candidate of researchCandidates) {
      tx.insert(researchTable).values(candidate).run();
    }
    for (const alert of alerts) {
      tx.insert(alertsTable).values(alert).run();
    }
    for (const item of watchlist) {
      tx.insert(watchlistItems).values(item).run();
    }
    tx.insert(appMeta)
      .values({
        key: 'demo_seed_version',
        value: DEMO_SEED_VERSION,
        updatedAt: account.createdAt,
      })
      .run();
  });

  return true;
}

export function incrementBootCount(db: AppDatabase): number {
  const existing = db.select().from(appMeta).where(eq(appMeta.key, 'boot_count')).get();
  const next = existing ? Number(existing.value) + 1 : 1;
  if (!Number.isInteger(next) || next < 1) {
    throw new Error('Stored boot count is invalid.');
  }
  const updatedAt = new Date().toISOString();
  db.insert(appMeta)
    .values({ key: 'boot_count', value: String(next), updatedAt })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: String(next), updatedAt },
    })
    .run();
  return next;
}
