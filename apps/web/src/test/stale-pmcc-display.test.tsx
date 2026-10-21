import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Portfolio, PortfolioPosition } from '@optionscout/shared';
import { OpenPositionsTable } from '../components/overview/PortfolioDashboard';
import { confirmedShortLeg } from '../components/overview/confirmedShort';
import { buildSnapshot } from '../components/overview/overviewModel';

const longSymbol = 'CVX   280121C00155000';
const closedShort = 'CVX   261030C00227500';
const openShort = 'CVX   261106C00235000';

function row(symbol: string, direction: PortfolioPosition['direction'], expiration: string): PortfolioPosition {
  return {
    id: symbol,
    symbol,
    underlying: 'CVX',
    optionRight: 'call',
    strike: '1',
    expiration,
    daysRemaining: 1,
    multiplier: '100',
    direction,
    openQuantity: direction === 'flat' ? '0' : '1',
    openedAt: null,
    originalPremium: null,
    entryCost: null,
    remainingBasis: null,
    marketValue: null,
    realized: null,
    unrealized: null,
    bid: null,
    ask: null,
    mid: null,
    mark: null,
    quoteAsOf: null,
    quoteFetchedAt: null,
    quoteFreshness: 'missing',
    status: 'partial',
    issues: [],
    cycles: [],
  } as unknown as PortfolioPosition;
}

describe('stale confirmed short display', () => {
  const positions = [
    row(longSymbol, 'long', '2028-01-21'),
    row(closedShort, 'flat', '2026-10-30'),
    row(openShort, 'short', '2026-11-06'),
  ];

  it('treats a flat confirmed short as closed history', () => {
    expect(confirmedShortLeg([closedShort], positions)).toEqual({ activeSymbol: null, closed: true });
  });

  it('uses the open November short for next expiration and leaves October 30 out of open positions', () => {
    const portfolio = {
      positions,
      strategies: [{
        id: 'strategy-1',
        underlying: 'CVX',
        longSymbol,
        createdAt: '2026-10-13T00:00:00.000Z',
        performance: { shortSymbols: [closedShort] },
      }],
      realizedAudit: { label: 'Reconstructed realized results — partial accounting', unknownFeeCount: 1, totalIncluded: '0.00' },
      history: { accountingComplete: false },
    } as unknown as Portfolio;
    const expiration = buildSnapshot(portfolio, '2026-10-21').find((card) => card.id === 'expiration');
    expect(expiration?.detail).toContain('2026-11-06');
    expect(expiration?.detail).not.toContain('2026-10-30');
    const active = buildSnapshot(portfolio, '2026-10-21').find((card) => card.id === 'strategies');
    expect(active?.value).toBe('0');
    expect(active?.detail).toMatch(/not counted/i);
    const openPair = {
      ...portfolio,
      positions: positions.map((position) => position.symbol === closedShort ? { ...position, direction: 'short' as const, openQuantity: '1' } : position),
    } as unknown as Portfolio;
    expect(buildSnapshot(openPair, '2026-10-21').find((card) => card.id === 'strategies')?.value).toBe('1');
    render(
      <MemoryRouter>
        <OpenPositionsTable portfolio={portfolio} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Nov 6, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Oct 30, 2026/)).not.toBeInTheDocument();
    expect(screen.getByText(/confirmed short call is closed/i)).toBeInTheDocument();
    expect(screen.getByText('Short call')).toBeInTheDocument();
  });
});
