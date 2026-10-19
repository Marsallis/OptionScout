import { describe, expect, it } from 'vitest';
import { legs } from './fixtures.js';
import { daysBetween, projectDashboard, unrealizedPnl } from './metrics.js';

describe('demo portfolio math', () => {
  it('uses the fixed snapshot when counting days to expiration', () => {
    expect(daysBetween('2026-10-15T20:00:00.000Z', '2026-11-20')).toBe(36);
    expect(daysBetween('2026-10-15T20:00:00.000Z', '2026-12-18')).toBe(64);
    expect(daysBetween('2026-10-15T20:00:00.000Z', '2028-01-21')).toBe(463);
  });

  it('marks long and short contracts from the demo premium', () => {
    expect(unrealizedPnl('long', 42.5, 48.1, 1)).toBe(560);
    expect(unrealizedPnl('long', 55, 51.2, 1)).toBe(-380);
    expect(unrealizedPnl('short', 4.6, 5.1, 1)).toBe(-50);
  });

  it('projects the synthetic book totals', () => {
    const dashboard = projectDashboard();
    expect(dashboard.demo).toBe(true);
    expect(dashboard.dataSource).toBe('demo-fixture');
    expect(dashboard.summary).toEqual({
      openPositions: 4,
      leapsCapital: 17190,
      shortCallCreditsReceived: 1600,
      realizedPnl: 690,
      estimatedUnrealizedPnl: 645,
      upcomingExpirationCount: 2,
    });
  });

  it('keeps two LEAPS and two PMCCs, with closed and open short calls', () => {
    const dashboard = projectDashboard();
    expect(dashboard.positions.filter((position) => position.strategy === 'leaps')).toHaveLength(2);
    expect(dashboard.positions.filter((position) => position.strategy === 'pmcc')).toHaveLength(2);
    const shortCallTransactions = dashboard.transactions.filter((transaction) =>
      ['sell_to_open', 'buy_to_close', 'expire'].includes(transaction.action),
    );
    expect(shortCallTransactions.map((transaction) => transaction.action).sort()).toEqual([
      'buy_to_close',
      'expire',
      'sell_to_open',
      'sell_to_open',
      'sell_to_open',
      'sell_to_open',
    ]);
    expect(dashboard.upcomingExpirations.map((item) => item.underlying)).toEqual(['NVDA', 'AMZN']);
  });

  it('marks every projected record as demo data', () => {
    const dashboard = projectDashboard();
    const flagged = [
      ...dashboard.positions,
      ...dashboard.positions.flatMap((position) => position.legs),
      ...dashboard.transactions,
      ...dashboard.watchlist,
      ...dashboard.research,
      ...dashboard.alerts,
      ...dashboard.journal,
      ...dashboard.upcomingExpirations,
    ];
    expect(flagged.length).toBeGreaterThan(20);
    expect(flagged.every((item) => item.isDemo === true)).toBe(true);
  });

  it('builds tastytrade-style option symbols without calling the network', () => {
    const aapl = legs.find((item) => item.id === 'leg_aapl');
    expect(aapl?.tastySymbol).toBe('AAPL 280121C00200000');
    expect(aapl?.instrumentKey).toBe('option:AAPL280121C00200000');
  });
});
