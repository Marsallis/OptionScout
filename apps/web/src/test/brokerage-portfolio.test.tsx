import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolioSchema, type Portfolio, type PortfolioPosition } from '@optionscout/shared';
import { App } from '../App';
import { brokerFixture, dashboardFixture, settingsFixture } from './fixtures';

const longSymbol = 'ZZT   280121C00155000';
const shortSymbol = 'ZZT   261030C00227500';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function position(overrides: Partial<PortfolioPosition>): PortfolioPosition {
  return {
    id: 'pos-long',
    symbol: longSymbol,
    underlying: 'ZZT',
    optionRight: 'call',
    strike: '155',
    expiration: '2028-01-21',
    daysRemaining: 463,
    multiplier: '100',
    direction: 'long',
    openQuantity: '1',
    openedAt: '2026-09-08T14:58:45.480Z',
    originalPremium: '6300.00',
    entryCost: '6301.12',
    remainingBasis: '6301.12',
    marketValue: '6935.00',
    realized: '0.00',
    unrealized: '633.88',
    bid: '67.70',
    ask: '71.00',
    mid: '69.35',
    mark: '69.35',
    quoteAsOf: '2026-10-15T20:03:54.579Z',
    quoteFetchedAt: '2026-10-15T20:17:14.402Z',
    quoteFreshness: 'closed_session',
    entitlement: 'entitled',
    feesComplete: false,
    status: 'partial',
    issues: ['The broker marked the reported fees as estimated, so fee-adjusted figures are not fully reconciled.'],
    brokerAverageOpenPrice: '63.0',
    calculatedAverageOpenPrice: '63.0000',
    averagePriceDifference: '0.00',
    methodology: 'FIFO lots. REST marks are snapshots.',
    cycles: [
      {
        openingTransactionId: '472577804',
        symbol: longSymbol,
        side: 'long',
        openedAt: '2026-09-08T14:58:45.480Z',
        closedAt: null,
        originalQuantity: '1',
        openQuantity: '1',
        openingCash: '6300.00',
        closingCash: '0.00',
        openingFees: '1.12',
        fees: '1.12',
        feesComplete: false,
        realized: '0.00',
        status: 'open',
        notes: ['Opening cash is not realized profit.'],
      },
    ],
    ...overrides,
  };
}

function portfolio(confirmed: boolean): Portfolio {
  const performance = {
    assumptions: ['Known-fee net cash outlay is qualified while fees are estimated.'],
    warnings: ['At least one fee was not reported. Figures that include fees are incomplete.'],
    complete: false,
    longOriginalInvestment: '6301.12',
    longCurrentValue: '6935.00',
    longRealized: '0.00',
    longUnrealized: '633.88',
    shortCredits: '188.00',
    shortCloseCost: '0.00',
    shortFees: '1.13',
    shortRealized: '0.00',
    shortOpenLiability: '250.50',
    initialNetDebit: '6114.25',
    remainingNetValue: '6684.50',
    realized: '0.00',
    unrealized: '570.25',
    combined: '570.25',
    capitalAtRisk: '6114.25',
    capitalExplanation: 'Known-fee cash still committed is qualified while fees are estimated.',
    valuationModes: [
      {
        mode: 'broker-mark' as const,
        label: 'Brokerage-reported mark (REST mark field)',
        combinedUnrealized: '570.25',
        available: true,
      },
      {
        mode: 'midpoint' as const,
        label: 'Midpoint-based estimated unrealized P/L',
        combinedUnrealized: '570.25',
        available: true,
      },
      {
        mode: 'conservative-liquidation' as const,
        label: 'Conservative bid/ask liquidation illustration',
        combinedUnrealized: '382.75',
        available: true,
      },
    ],
    valuationSourceNote: 'Default open unrealized uses brokerage REST mark on each leg.',
    quoteAsOf: '2026-10-15T20:03:54.969Z',
    quoteFetchedAt: '2026-10-15T20:17:14.402Z',
    shortSymbols: [shortSymbol],
    shortDaysToExpiration: 15,
  };
  return {
    phase: '1C',
    demo: false,
    asOf: '2026-10-15T20:35:00.000Z',
    disclaimer: 'Brokerage figures are calculated from imported transactions and REST snapshots. Demo balances are not included.',
    history: { status: 'complete', coverageStart: '2025-10-15', coverageEnd: '2026-10-15', accountingComplete: false },
    health: {
      reconstructed: 2,
      openPositions: 2,
      missingOpenings: 0,
      unreconciled: 1,
      unknownFees: 2,
      quotesAvailable: 2,
      quotesUnavailable: 0,
      lastSyncAt: '2026-10-15T20:17:14.536Z',
      lastQuoteAt: '2026-10-15T20:03:54.969Z',
      confirmedGroups: confirmed ? 1 : 0,
      unconfirmedSuggestions: confirmed ? 0 : 1,
      excludedCashEvents: 38,
    },
    positions: [
      position({}),
      position({
        id: 'pos-short',
        symbol: shortSymbol,
        strike: '227.5',
        expiration: '2026-10-30',
        daysRemaining: 15,
        direction: 'short',
        openedAt: '2026-10-13T14:29:55.856Z',
        originalPremium: '188.00',
        entryCost: null,
        remainingBasis: '186.87',
        marketValue: '250.50',
        unrealized: '-63.63',
        bid: '2.28',
        ask: '2.73',
        mid: '2.505',
        mark: '2.505',
        quoteAsOf: '2026-10-15T20:03:54.969Z',
        brokerAverageOpenPrice: '1.88',
        calculatedAverageOpenPrice: '1.8800',
        cycles: [
          {
            openingTransactionId: '481797467',
            symbol: shortSymbol,
            side: 'short',
            openedAt: '2026-10-13T14:29:55.856Z',
            closedAt: null,
            originalQuantity: '1',
            openQuantity: '1',
            openingCash: '188.00',
            closingCash: '0.00',
            openingFees: '1.13',
            fees: '1.13',
            feesComplete: false,
            realized: '0.00',
            status: 'open',
            notes: ['Opening cash is not realized profit.'],
          },
        ],
      }),
      position({
        id: 'symbol:AMD',
        symbol: 'AMD   260402C00210000',
        underlying: 'AMD',
        strike: '210',
        expiration: '2026-04-02',
        daysRemaining: null,
        direction: 'flat',
        openQuantity: '0',
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
        entitlement: 'unknown',
        status: 'unreconciled',
        issues: ['An assignment was withheld because the stock leg is not accounted.'],
        brokerAverageOpenPrice: null,
        calculatedAverageOpenPrice: null,
        averagePriceDifference: null,
        cycles: [],
      }),
    ],
    realizedAudit: {
      totalIncluded: '34.00',
      label: 'Reconstructed realized results — partial accounting',
      howCalculated:
        'Sum of reconstructed FIFO option-cycle realized figures marked included. Open short credits, deposits, withdrawals, balance adjustments, and unresolved assignment/transfer cycles are excluded. Incomplete fees qualify the total as partial accounting.',
      lines: [
        {
          id: 'cvx-closed-short',
          underlying: 'ZZT',
          symbol: shortSymbol,
          side: 'short' as const,
          status: 'closed',
          openedAt: '2026-09-15T14:00:00.000Z',
          closedAt: '2026-09-16T14:00:00.000Z',
          originalQuantity: '1',
          openQuantity: '0',
          multiplier: '100',
          openingCash: '70.00',
          closingCash: '35.00',
          fees: '1.00',
          realized: '34.00',
          feesComplete: false,
          includedInTotal: true,
          note: 'Closed cycle included; fees incomplete — treat as partial accounting.',
        },
        {
          id: 'amd-assign',
          underlying: 'AMD',
          symbol: 'AMD   260402C00210000',
          side: 'short' as const,
          status: 'unreconciled',
          openedAt: '2026-04-01T14:00:00.000Z',
          closedAt: null,
          originalQuantity: '1',
          openQuantity: '0',
          multiplier: '100',
          openingCash: '210.00',
          closingCash: '0.00',
          fees: '0.00',
          realized: null,
          feesComplete: false,
          includedInTotal: false,
          note: 'Excluded — unreconciled cycle or withheld realized figure.',
        },
      ],
      excludedNotes: ['AMD   260402C00210000: Excluded — unreconciled cycle or withheld realized figure.'],
      grossShortOpeningCredits: '188.00',
      closedShortRealized: '34.00',
      closedLongRealized: null,
      unknownFeeCount: 2,
      includedCycleCount: 1,
    },
    suggestions: confirmed
      ? []
      : [
          {
            underlying: 'ZZT',
            longSymbol,
            shortSymbol,
            ambiguous: false,
            reason: 'One long call expires after this short call and has enough quantity. It is not saved until you confirm it.',
          },
        ],
    strategies: confirmed
      ? [{ id: 'strategy-1', underlying: 'ZZT', longSymbol, createdAt: '2026-10-15T20:40:00.000Z', performance }]
      : [],
  };
}

function connectedBroker(view: 'demo' | 'brokerage') {
  return {
    ...brokerFixture,
    portfolioView: view,
    authenticated: true,
    ownerConfigured: true,
    connection: {
      ...brokerFixture.connection,
      state: 'connected' as const,
      environment: 'production' as const,
      liveEnabled: true,
      secretFilePresent: true,
      message: 'Read-only tastytrade session.',
    },
    quotes: {
      ...brokerFixture.quotes,
      state: 'closed_session' as const,
      entitlement: 'entitled' as const,
      asOf: '2026-10-15T20:03:54.969Z',
      fetchedAt: '2026-10-15T20:17:14.402Z',
      message: 'The quote timestamp is from outside the regular US equity session.',
    },
  };
}

describe('authenticated brokerage portfolio', () => {
  it('accepts the brokerage fixture', () => {
    const parsed = portfolioSchema.safeParse(portfolio(true));
    expect(parsed.success ? 'ok' : parsed.error.issues).toBe('ok');
  });

  let view: 'demo' | 'brokerage';
  let confirmed: boolean;
  let authenticated: boolean;
  const requested: string[] = [];

  beforeEach(() => {
    view = 'brokerage';
    confirmed = false;
    authenticated = true;
    requested.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requested.push(`${method} ${url}`);
        if (url.endsWith('/api/session')) {
          return jsonResponse({
            authenticated,
            ownerConfigured: true,
            expiresAt: authenticated ? '2026-10-16T00:00:00.000Z' : null,
            csrfToken: authenticated ? 'csrf-test' : null,
          });
        }
        if (url.endsWith('/api/settings') && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as { portfolioView?: 'demo' | 'brokerage' };
          if (body.portfolioView) view = body.portfolioView;
          return jsonResponse({ ...settingsFixture, portfolioView: view });
        }
        if (url.endsWith('/api/settings')) return jsonResponse({ ...settingsFixture, portfolioView: view });
        if (url.endsWith('/api/broker/strategies') && method === 'POST') {
          confirmed = true;
          return jsonResponse(portfolio(true));
        }
        if (url.endsWith('/api/broker/portfolio')) return jsonResponse(portfolio(confirmed));
        if (url.endsWith('/api/broker')) return jsonResponse(connectedBroker(view));
        if (url.endsWith('/api/dashboard')) return jsonResponse(dashboardFixture);
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }),
    );
  });

  it('shows the fictional ZZT book, confirms a PMCC, and returns to the separate demo book', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'My Portfolio' })).toBeInTheDocument();
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('LIVE BROKERAGE');
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('CLOSED SESSION');
    expect(screen.getByRole('link', { name: /280121C00155000/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /261030C00227500/ })).toBeInTheDocument();
    expect(screen.getByText(/An assignment was withheld/i)).toBeInTheDocument();
    expect(screen.queryByText('$17,190.00')).not.toBeInTheDocument();
    expect(screen.getByText('Realized P/L — Needs reconciliation')).toBeInTheDocument();
    expect(screen.queryByText('$17,190.00')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Advanced Portfolio Details' }));
    await user.click(screen.getByRole('button', { name: 'How this was calculated' }));
    expect(screen.getAllByText(/Reconstructed realized results — partial accounting/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/FIFO option-cycle realized figures/i)).toBeInTheDocument();
    expect(screen.getAllByText(/fees incomplete/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not in total/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm this PMCC' }));
    await user.click(await screen.findByRole('button', { name: 'View strategy details' }));
    expect(await screen.findByText(/Known-fee net opening outlay: \$6,114\.25/)).toBeInTheDocument();
    expect(screen.getByText(/Combined estimated P\/L \(mark\): \$570\.25/)).toBeInTheDocument();
    expect(screen.getByText(/Incomplete accounting/i)).toBeInTheDocument();
    expect(screen.getByText(/Brokerage-reported mark \(REST mark field\): \$570\.25/)).toBeInTheDocument();
    expect(screen.getAllByText(/qualified while fees are estimated/i).length).toBeGreaterThan(0);
    expect(requested.some((entry) => entry.includes('/api/broker/sync'))).toBe(false);
    expect(requested.some((entry) => entry.includes('/api/finder/smart-scans'))).toBe(false);

    await user.click(screen.getByRole('link', { name: 'My Positions' }));
    expect(await screen.findByText(/Open contracts you hold/)).toBeInTheDocument();
    expect(screen.getByText(/280121C00155000/)).toBeInTheDocument();
    expect(screen.getByText(/261030C00227500/)).toBeInTheDocument();
    expect(screen.queryByText(/260402C00210000/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Overview' }));

    await user.click(screen.getByRole('link', { name: /280121C00155000/ }));
    expect(await screen.findByText(/Gross premium: \$6,300\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Opening cash is not realized profit/i)).toBeInTheDocument();
    expect(screen.getAllByText(/closed session/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(await screen.findByRole('radio', { name: 'Synthetic demo book' }));
    expect(await screen.findByText('Saved on this device.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(await screen.findByText('$17,190.00')).toBeInTheDocument();
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('DEMO MODE');
    expect(screen.queryByRole('link', { name: /280121C00155000/ })).not.toBeInTheDocument();
  });

  it('hides brokerage positions from a signed-out portfolio view', async () => {
    authenticated = false;
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Sign in on Broker & Data/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /280121C00155000/ })).not.toBeInTheDocument();
    expect(screen.queryByText('$6,300.00')).not.toBeInTheDocument();
    expect(requested.some((entry) => entry.includes('/api/broker/portfolio'))).toBe(false);
  });
});
