import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  VALUATION_MODE_LABELS,
  buildMultiModeValuation,
  buildRealizedAudit,
  type Portfolio,
  type StrategyConfirm,
} from '@optionscout/shared';
import { parseOccSymbol } from '../brokerage/normalize.js';
import { classifyQuoteFreshness } from '../brokerage/market-hours.js';
import type { AppDatabase } from '../db/client.js';
import { brokerAccounts, brokerPositions, brokerTransactions, quoteSnapshots, strategyGroups, strategyMembers, syncRuns } from '../db/schema.js';
import { HttpError } from '../http.js';
import {
  reconstructPortfolio,
  type AccountingFees,
  type AccountingPosition,
  type AccountingQuote,
  type AccountingTransaction,
  type SymbolLedger,
} from './engine.js';
import { strategyPerformance, suggestPairings } from './strategy.js';

function underlyingFrom(symbol: string): string {
  return /^([A-Z]{1,6})/.exec(symbol.trim())?.[1] ?? symbol;
}

function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const METHODOLOGY =
  'FIFO lots. Gross premium and known fees are separate from fully reconciled cash. Short fees reduce the credit. Opening short premium is unrealized until a supported close. Default open valuation uses the brokerage REST mark field for every leg (not a silent mix of mid and ask). Alternate midpoint and conservative liquidation illustrations are labeled separately. REST quotes are snapshots, not a live stream.';

function decimalText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function feesOf(json: string): AccountingFees {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      clearing: decimalText(parsed['clearing-fees']),
      regulatory: decimalText(parsed['regulatory-fees']),
      proprietary: decimalText(parsed['proprietary-index-option-fees']),
      other: decimalText(parsed['other-fees']),
    };
  } catch {
    return { clearing: null, regulatory: null, proprietary: null, other: null };
  }
}

function providerCash(rawJson: string): { otherCharge: string | null; hasOtherCharge: boolean; feesEstimated: boolean; netValue: string | null; netValueEffect: string | null } {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return {
      hasOtherCharge: Object.prototype.hasOwnProperty.call(parsed, 'other-charge'),
      otherCharge: decimalText(parsed['other-charge']),
      feesEstimated: parsed['is-estimated-fee'] === true,
      netValue: decimalText(parsed['net-value']),
      netValueEffect: typeof parsed['net-value-effect'] === 'string' ? parsed['net-value-effect'] : null,
    };
  } catch {
    return { hasOtherCharge: false, otherCharge: null, feesEstimated: false, netValue: null, netValueEffect: null };
  }
}

function optionRight(symbol: string): 'call' | 'put' | null {
  const match = /([CP])\d{8}$/.exec(symbol.trim());
  if (match?.[1] === 'C') return 'call';
  if (match?.[1] === 'P') return 'put';
  return null;
}

function toView(ledger: SymbolLedger, quote: AccountingQuote | null) {
  return {
    id: ledger.positionId ?? `symbol:${ledger.symbol}`,
    symbol: ledger.symbol,
    underlying: ledger.underlying ?? underlyingFrom(ledger.symbol),
    optionRight: ledger.optionRight,
    strike: ledger.strike,
    expiration: ledger.expiration,
    daysRemaining: ledger.daysRemaining,
    multiplier: ledger.multiplier,
    direction: ledger.direction,
    openQuantity: ledger.openQuantity,
    openedAt: dateOrNull(ledger.openedAt),
    originalPremium: ledger.originalPremium,
    entryCost: ledger.entryCost,
    remainingBasis: ledger.remainingBasis,
    marketValue: ledger.marketValue,
    realized: ledger.realized,
    unrealized: ledger.unrealized,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    mid: quote?.mid ?? null,
    mark: quote?.mark ?? null,
    quoteAsOf: dateOrNull(quote?.quoteAsOf),
    quoteFetchedAt: dateOrNull(quote?.fetchedAt),
    quoteFreshness: quote?.freshness ?? 'missing',
    entitlement: quote?.entitlement ?? 'unknown',
    feesComplete: ledger.feesComplete,
    status: ledger.status,
    issues: ledger.issues,
    brokerAverageOpenPrice: ledger.brokerAverageOpenPrice,
    calculatedAverageOpenPrice: ledger.calculatedAverageOpenPrice,
    averagePriceDifference: ledger.averagePriceDifference,
    methodology: METHODOLOGY,
    cycles: ledger.cycles.map((cycle) => ({
      openingTransactionId: cycle.openingTransactionId,
      symbol: cycle.symbol,
      side: cycle.side,
      openedAt: dateOrNull(cycle.openedAt),
      closedAt: dateOrNull(cycle.closedAt),
      originalQuantity: cycle.originalQuantity,
      openQuantity: cycle.openQuantity,
      openingCash: cycle.openingCash,
      closingCash: cycle.closingCash,
      openingFees: cycle.openingFees,
      fees: cycle.fees,
      feesComplete: cycle.feesComplete,
      realized: cycle.realized,
      status: cycle.status,
      notes: cycle.events.map((event) => event.note),
    })),
  };
}

export function loadReconstruction(db: AppDatabase, accountId: string, now: Date) {
  const positions = db.select().from(brokerPositions).where(eq(brokerPositions.brokerAccountId, accountId)).all();
  const transactions = db.select().from(brokerTransactions).where(eq(brokerTransactions.brokerAccountId, accountId)).all();
  const snapshots = db.select().from(quoteSnapshots).orderBy(desc(quoteSnapshots.fetchedAt)).all();
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const row of snapshots) {
    if (row.symbol && !latest.has(row.symbol)) latest.set(row.symbol, row);
  }
  const accountingPositions: AccountingPosition[] = positions
    .filter((row) => row.status === 'open')
    .map((row) => {
      const parsed = parseOccSymbol(row.providerSymbol);
      return {
        id: row.id,
        providerSymbol: row.providerSymbol,
        underlyingSymbol: row.underlyingSymbol,
        instrumentType: row.instrumentType,
        quantity: row.quantity,
        direction: row.direction as AccountingPosition['direction'],
        strike: row.strike ?? parsed?.strike ?? null,
        expiration: row.expiration ?? parsed?.expiration ?? null,
        averageOpenPrice: row.averageOpenPrice,
        multiplier: row.multiplier,
        optionRight: optionRight(row.providerSymbol),
      };
    });
  const accountingTransactions: AccountingTransaction[] = transactions.map((row) => {
    const storedFees = feesOf(row.feesJson);
    const provider = providerCash(row.rawJson);
    return {
      id: row.providerTransactionId,
      symbol: row.symbol,
      instrumentType: row.instrumentType,
      action: row.action,
      quantity: row.quantity,
      price: row.price,
      executedAt: row.executedAt,
      grossValue: row.grossValue,
      valueEffect: row.valueEffect,
      commission: row.commission,
      fees: { ...storedFees, other: provider.hasOtherCharge ? provider.otherCharge : storedFees.other },
      feesEstimated: provider.feesEstimated,
      netValue: provider.netValue,
      netValueEffect: provider.netValueEffect,
      classification: row.classification as AccountingTransaction['classification'],
      transactionType: row.transactionType,
      transactionSubtype: row.transactionSubtype,
    };
  });
  const quotes: AccountingQuote[] = [...latest.values()].map((row) => {
    const denied = row.entitlement === 'denied';
    return {
      symbol: row.symbol,
      bid: row.bid,
      ask: row.ask,
      mid: row.mid,
      mark: row.mark,
      quoteAsOf: row.quoteAsOf,
      fetchedAt: row.fetchedAt,
      freshness: denied ? 'unavailable' : classifyQuoteFreshness(row.quoteAsOf, now),
      entitlement: row.entitlement === 'entitled' || row.entitlement === 'denied' ? row.entitlement : 'unknown',
    };
  });
  const reconstruction = reconstructPortfolio({
    transactions: accountingTransactions,
    positions: accountingPositions,
    quotes,
    asOf: now.toISOString(),
  });
  return { reconstruction, quotes, sourceCount: transactions.length };
}

export function buildPortfolio(db: AppDatabase, accountId: string, now = new Date()): Portfolio {
  const account = db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId)).get();
  if (!account) throw new HttpError(404, 'That account is not available.');
  const { reconstruction, quotes } = loadReconstruction(db, accountId, now);
  const bySymbol = new Map(reconstruction.symbols.map((symbol) => [symbol.symbol, symbol]));
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const groups = db.select().from(strategyGroups).where(eq(strategyGroups.brokerAccountId, accountId)).all();
  const strategies = groups.map((group) => {
    const members = db.select().from(strategyMembers).where(eq(strategyMembers.strategyGroupId, group.id)).all();
    const long = bySymbol.get(group.longSymbol);
    const shorts = members.flatMap((member) => {
      const ledger = bySymbol.get(member.providerSymbol);
      const cycle = ledger?.cycles.find((item) => item.openingTransactionId === member.openingTransactionId);
      return ledger && cycle ? [{ ledger, cycle }] : [];
    });
    const performance = long ? strategyPerformance(long, shorts) : strategyPerformance(emptyLong(group.longSymbol), []);
    if (!long) performance.warnings.push('The confirmed long call is no longer in the reconstructed book.');
    if (shorts.length !== members.length) performance.warnings.push('A confirmed short cycle could not be found.');
    if (!long || shorts.length !== members.length) performance.complete = false;
    const valuationLegs = [
      ...(long
        ? [
            {
              symbol: long.symbol,
              direction: long.direction,
              openQuantity: long.openQuantity,
              multiplier: long.multiplier,
              remainingBasis: long.remainingBasis,
              bid: long.quote?.bid ?? null,
              ask: long.quote?.ask ?? null,
              mid: long.quote?.mid ?? null,
              mark: long.quote?.mark ?? null,
              quoteAsOf: long.quote?.quoteAsOf ?? null,
              quoteFetchedAt: long.quote?.fetchedAt ?? null,
            },
          ]
        : []),
      ...shorts
        .filter((item) => Number(item.cycle.openQuantity) > 0)
        .map((item) => ({
          symbol: item.ledger.symbol,
          direction: item.ledger.direction as 'long' | 'short' | 'flat',
          openQuantity: item.cycle.openQuantity,
          multiplier: item.ledger.multiplier,
          remainingBasis: (() => {
            const premium = Number(item.cycle.remainingPremium);
            const fees = Number(item.cycle.remainingFees);
            if (!Number.isFinite(premium) || !Number.isFinite(fees)) return item.ledger.remainingBasis;
            return (premium - fees).toFixed(2);
          })(),
          bid: item.ledger.quote?.bid ?? null,
          ask: item.ledger.quote?.ask ?? null,
          mid: item.ledger.quote?.mid ?? null,
          mark: item.ledger.quote?.mark ?? null,
          quoteAsOf: item.ledger.quote?.quoteAsOf ?? null,
          quoteFetchedAt: item.ledger.quote?.fetchedAt ?? null,
        })),
    ];
    const multi = buildMultiModeValuation(valuationLegs);
    performance.valuationModes = (['broker-mark', 'midpoint', 'conservative-liquidation'] as const).map((mode) => ({
      mode,
      label: VALUATION_MODE_LABELS[mode],
      combinedUnrealized: multi.combinedUnrealized[mode],
      available: multi.combinedUnrealized[mode] != null,
    }));
    performance.quoteAsOf = multi.quoteAsOf;
    performance.quoteFetchedAt = multi.quoteFetchedAt;
    for (const warning of multi.warnings) {
      if (!performance.warnings.includes(warning)) performance.warnings.push(warning);
    }
    return {
      id: group.id,
      underlying: group.underlyingSymbol,
      longSymbol: group.longSymbol,
      createdAt: group.createdAt,
      performance,
    };
  });
  const confirmedPairKeys = new Set(
    groups.flatMap((group) => {
      const members = db.select().from(strategyMembers).where(eq(strategyMembers.strategyGroupId, group.id)).all();
      return members.map((member) => `${group.longSymbol}::${member.providerSymbol}`);
    }),
  );
  const suggestions = suggestPairings(reconstruction.symbols).filter(
    (suggestion) => !confirmedPairKeys.has(`${suggestion.longSymbol}::${suggestion.shortSymbol}`),
  );
  const openLedgers = reconstruction.symbols.filter((symbol) => symbol.brokerDirection === 'long' || symbol.brokerDirection === 'short');
  const runs = db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.brokerAccountId, accountId)))
    .all()
    .filter((row) => row.finishedAt && (row.status === 'succeeded' || row.status === 'incomplete'))
    .sort((left, right) => (right.finishedAt ?? '').localeCompare(left.finishedAt ?? ''));
  const lastQuoteAt = quotes.map((quote) => quote.quoteAsOf).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const positions = reconstruction.symbols
    .filter((symbol) => symbol.positionId || symbol.cycles.length > 0 || symbol.status === 'unreconciled' || symbol.status === 'missing-opening')
    .map((symbol) => toView(symbol, quoteBySymbol.get(symbol.symbol) ?? null));
  const unresolved = reconstruction.symbols.some((symbol) => symbol.status === 'unreconciled' || symbol.status === 'missing-opening');
  const accountingComplete =
    openLedgers.length > 0 &&
    !unresolved &&
    openLedgers.every((symbol) => symbol.status === 'complete') &&
    strategies.every((strategy) => strategy.performance.complete);
  return {
    phase: '1C',
    demo: false,
    asOf: now.toISOString(),
    disclaimer: 'Brokerage figures are calculated from imported transactions and REST snapshots. Demo balances are not included.',
    history: {
      status: account.transactionHistoryStatus as Portfolio['history']['status'],
      coverageStart: account.historyCoverageStart,
      coverageEnd: account.historyCoverageEnd,
      accountingComplete,
    },
    health: {
      reconstructed: openLedgers.filter((symbol) => symbol.status === 'complete' || symbol.status === 'partial').length,
      openPositions: openLedgers.length,
      missingOpenings: openLedgers.filter((symbol) => symbol.status === 'missing-opening').length,
      unreconciled: reconstruction.symbols.filter((symbol) => symbol.status === 'unreconciled').length,
      unknownFees: reconstruction.symbols.filter((symbol) => !symbol.feesComplete && symbol.cycles.length > 0).length,
      quotesAvailable: openLedgers.filter((symbol) => quoteBySymbol.get(symbol.symbol)?.mark).length,
      quotesUnavailable: openLedgers.filter((symbol) => !quoteBySymbol.get(symbol.symbol)?.mark).length,
      lastSyncAt: runs[0]?.finishedAt ?? null,
      lastQuoteAt,
      confirmedGroups: strategies.length,
      unconfirmedSuggestions: suggestions.length,
      excludedCashEvents: reconstruction.excludedCashEvents,
    },
    positions,
    realizedAudit: buildRealizedAudit(positions),
    suggestions,
    strategies,
  };
}

function emptyLong(symbol: string): SymbolLedger {
  return {
    symbol,
    positionId: null,
    underlying: null,
    instrumentType: 'Equity Option',
    optionRight: 'call',
    strike: null,
    expiration: null,
    daysRemaining: null,
    multiplier: null,
    brokerQuantity: null,
    brokerDirection: null,
    openQuantity: '0',
    direction: 'flat',
    openedAt: null,
    originalPremium: null,
    entryCost: null,
    remainingPremium: null,
    remainingFees: null,
    remainingBasis: null,
    marketValue: null,
    realized: null,
    unrealized: null,
    feesComplete: false,
    status: 'missing-opening',
    issues: ['The confirmed long call is no longer open.'],
    cycles: [],
    quote: null,
    brokerAverageOpenPrice: null,
    calculatedAverageOpenPrice: null,
    averagePriceDifference: null,
  };
}

export function confirmStrategy(db: AppDatabase, accountId: string, input: StrategyConfirm, now = new Date()): Portfolio {
  const { reconstruction } = loadReconstruction(db, accountId, now);
  const long = reconstruction.symbols.find((symbol) => symbol.symbol === input.longSymbol);
  if (!long || long.direction !== 'long' || long.optionRight !== 'call' || long.underlying !== input.underlying) {
    throw new HttpError(400, 'Choose an open long call on that underlying.');
  }
  const existingMembers = db
    .select()
    .from(strategyMembers)
    .all()
    .filter((member) => {
      const group = db.select().from(strategyGroups).where(eq(strategyGroups.id, member.strategyGroupId)).get();
      return group?.brokerAccountId === accountId;
    });
  for (const cycle of input.shortCycles) {
    const ledger = reconstruction.symbols.find((symbol) => symbol.symbol === cycle.providerSymbol);
    const match = ledger?.cycles.find((item) => item.openingTransactionId === cycle.openingTransactionId && item.side === 'short');
    if (!ledger || !match || ledger.underlying !== input.underlying) {
      throw new HttpError(400, 'Each confirmed short cycle must be a short call on the same underlying.');
    }
    if (long.expiration && ledger.expiration && long.expiration <= ledger.expiration) {
      throw new HttpError(400, 'The long call must expire after the short call.');
    }
    if (long.multiplier && ledger.multiplier && long.multiplier !== ledger.multiplier) {
      throw new HttpError(400, 'The long and short contracts use different multipliers.');
    }
    if (existingMembers.some((member) => member.openingTransactionId === cycle.openingTransactionId && member.providerSymbol === cycle.providerSymbol)) {
      throw new HttpError(409, 'That short cycle is already confirmed in a strategy.');
    }
  }
  const groupId = randomUUID();
  db.insert(strategyGroups)
    .values({
      id: groupId,
      brokerAccountId: accountId,
      underlyingSymbol: input.underlying,
      longSymbol: input.longSymbol,
      createdAt: now.toISOString(),
    })
    .run();
  for (const cycle of input.shortCycles) {
    db.insert(strategyMembers)
      .values({
        id: randomUUID(),
        strategyGroupId: groupId,
        providerSymbol: cycle.providerSymbol,
        openingTransactionId: cycle.openingTransactionId,
      })
      .run();
  }
  return buildPortfolio(db, accountId, now);
}

export function deleteStrategy(db: AppDatabase, accountId: string, strategyId: string, now = new Date()): Portfolio {
  const group = db.select().from(strategyGroups).where(eq(strategyGroups.id, strategyId)).get();
  if (!group || group.brokerAccountId !== accountId) throw new HttpError(404, 'That strategy is not available.');
  db.delete(strategyMembers).where(eq(strategyMembers.strategyGroupId, strategyId)).run();
  db.delete(strategyGroups).where(eq(strategyGroups.id, strategyId)).run();
  return buildPortfolio(db, accountId, now);
}
