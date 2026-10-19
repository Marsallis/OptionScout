import { describe, expect, it } from 'vitest';
import { DEMO_AS_OF, DEMO_DISCLAIMER } from './phase.js';
import { dashboardSchema } from './schemas.js';

const leg = {
  id: 'leg_aapl',
  side: 'long' as const,
  optionType: 'call' as const,
  strike: 200,
  expiration: '2028-01-21',
  quantity: 1,
  openPremium: 42.5,
  status: 'open' as const,
  instrumentKey: 'option:AAPL280121C00200000',
  tastySymbol: 'AAPL 280121C00200000',
  mark: 48.1,
  delta: 0.61,
  theta: -0.018,
  daysToExpiration: 463,
  unrealizedPnl: 560,
  isDemo: true as const,
};

const validDashboard = {
  demo: true as const,
  dataSource: 'demo-fixture' as const,
  disclaimer: DEMO_DISCLAIMER,
  asOf: DEMO_AS_OF,
  phase: '1C' as const,
  brokerage: {
    providerId: 'demo' as const,
    connectionStatus: 'demo-only' as const,
    accountName: 'Synthetic Demo Account',
    liveCredentialsRequired: false as const,
    oauthImplemented: false as const,
    streamingImplemented: false as const,
    ordersEnabled: false as const,
    label: 'Demo provider',
  },
  summary: {
    openPositions: 1,
    leapsCapital: 4250,
    shortCallCreditsReceived: 0,
    realizedPnl: 0,
    estimatedUnrealizedPnl: 560,
    upcomingExpirationCount: 0,
  },
  positions: [
    {
      id: 'pos_aapl',
      underlying: 'AAPL',
      strategy: 'leaps' as const,
      status: 'open' as const,
      openedOn: '2026-06-02',
      thesis: 'Demo long-dated call.',
      structure: 'Long Jan 21, 2028 200 Call',
      closedShortSummary: null,
      isDemo: true as const,
      legs: [leg],
      leapsCapital: 4250,
      shortCallCredits: 0,
      realizedPnl: 0,
      estimatedUnrealizedPnl: 560,
      netDelta: 0.61,
    },
  ],
  transactions: [],
  upcomingExpirations: [],
  watchlist: [],
  research: [],
  alerts: [],
  journal: [],
};

describe('dashboard contract', () => {
  it('accepts a demo dashboard', () => {
    expect(dashboardSchema.parse(validDashboard).demo).toBe(true);
  });

  it('rejects a payload that is not marked as demo data', () => {
    expect(() => dashboardSchema.parse({ ...validDashboard, demo: false })).toThrow();
  });

  it('rejects live brokerage connection fields', () => {
    expect(() =>
      dashboardSchema.parse({
        ...validDashboard,
        brokerage: { ...validDashboard.brokerage, ordersEnabled: true },
      }),
    ).toThrow();
  });
});
