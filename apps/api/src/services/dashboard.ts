import { dashboardSchema, type Dashboard } from '@optionscout/shared';
import type { PortfolioSnapshot } from '../demo/metrics.js';
import { projectDashboard } from '../demo/metrics.js';
import type { AppDatabase } from '../db/client.js';
import {
  accounts,
  alerts,
  journalEntries,
  marks,
  optionLegs,
  positions,
  researchCandidates,
  transactions,
  watchlistItems,
} from '../db/schema.js';

function requiredString<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unsupported ${label} in the local database.`);
}

export function loadPortfolio(db: AppDatabase): PortfolioSnapshot {
  const account = db.select().from(accounts).all()[0];
  if (!account) {
    throw new Error('No local account is stored.');
  }

  return {
    accountName: account.displayName,
    positions: db.select().from(positions).all().map((position) => ({
      id: position.id,
      accountId: position.accountId,
      underlying: position.underlying,
      strategy: requiredString(position.strategy, ['leaps', 'pmcc'] as const, 'strategy'),
      status: requiredString(position.status, ['open', 'closed'] as const, 'position status'),
      openedOn: position.openedOn,
      closedOn: position.closedOn,
      thesis: position.thesis,
      isDemo: position.isDemo as true,
      createdAt: position.createdAt,
    })),
    legs: db.select().from(optionLegs).all().map((leg) => ({
      id: leg.id,
      positionId: leg.positionId,
      side: requiredString(leg.side, ['long', 'short'] as const, 'side'),
      optionType: requiredString(leg.optionType, ['call', 'put'] as const, 'option type'),
      strike: leg.strike,
      expiration: leg.expiration,
      quantity: leg.quantity,
      openPremium: leg.openPremium,
      status: requiredString(leg.status, ['open', 'closed'] as const, 'leg status'),
      openedOn: leg.openedOn,
      closedOn: leg.closedOn,
      instrumentKey: leg.instrumentKey,
      tastySymbol: leg.tastySymbol,
      isDemo: leg.isDemo as true,
    })),
    transactions: db.select().from(transactions).all().map((transaction) => ({
      id: transaction.id,
      positionId: transaction.positionId,
      legId: transaction.legId,
      action: requiredString(
        transaction.action,
        ['buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close', 'expire'] as const,
        'transaction action',
      ),
      quantity: transaction.quantity,
      premium: transaction.premium,
      cashFlow: transaction.cashFlow,
      occurredOn: transaction.occurredOn,
      accountId: transaction.accountId,
      isDemo: transaction.isDemo as true,
    })),
    marks: db.select().from(marks).all().map((mark) => ({
      id: mark.id,
      instrumentKey: mark.instrumentKey,
      mark: mark.mark,
      delta: mark.delta,
      gamma: mark.gamma,
      theta: mark.theta,
      vega: mark.vega,
      iv: mark.iv,
      asOf: mark.asOf,
      source: mark.source,
      isDemo: mark.isDemo as true,
    })),
    journalEntries: db.select().from(journalEntries).all().map((entry) => ({
      id: entry.id,
      positionId: entry.positionId,
      title: entry.title,
      body: entry.body,
      createdAt: entry.createdAt,
      isDemo: entry.isDemo as true,
    })),
    researchCandidates: db.select().from(researchCandidates).all().map((candidate) => ({
      id: candidate.id,
      underlying: candidate.underlying,
      title: candidate.title,
      summary: candidate.summary,
      expiration: candidate.expiration,
      strike: candidate.strike,
      optionType: requiredString(candidate.optionType, ['call', 'put'] as const, 'option type'),
      illustrativePremium: candidate.illustrativePremium,
      criteriaNote: candidate.criteriaNote,
      createdAt: candidate.createdAt,
      isDemo: candidate.isDemo as true,
    })),
    alerts: db.select().from(alerts).all().map((alert) => ({
      id: alert.id,
      positionId: alert.positionId,
      severity: requiredString(alert.severity, ['info', 'attention', 'warning'] as const, 'alert severity'),
      title: alert.title,
      message: alert.message,
      createdAt: alert.createdAt,
      isDemo: alert.isDemo as true,
    })),
    watchlist: db.select().from(watchlistItems).all().map((item) => ({
      id: item.id,
      underlying: item.underlying,
      note: item.note,
      demoLast: item.demoLast,
      sortOrder: item.sortOrder,
      isDemo: item.isDemo as true,
    })),
  };
}

export function buildDashboard(db: AppDatabase): Dashboard {
  const projected = projectDashboard(loadPortfolio(db));
  const parsed = dashboardSchema.safeParse(projected);
  if (!parsed.success) {
    throw new Error(`Dashboard contract failed: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
