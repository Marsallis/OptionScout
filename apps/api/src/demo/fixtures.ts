import { DEMO_AS_OF } from '@optionscout/shared';

/**
 * Deterministic synthetic portfolio.
 * Premiums and marks are illustrative numbers for the demo snapshot dated 2026-10-15.
 * They are not historical prices and must not be displayed as live quotes.
 */

export const DEMO_SEED_VERSION = '1a-1';

export type OptionSide = 'long' | 'short';
export type OptionType = 'call' | 'put';
export type TradeAction = 'buy_to_open' | 'sell_to_open' | 'buy_to_close' | 'sell_to_close' | 'expire';

export interface FixtureLeg {
  id: string;
  positionId: string;
  side: OptionSide;
  optionType: OptionType;
  strike: number;
  expiration: string;
  quantity: number;
  openPremium: number;
  status: 'open' | 'closed';
  openedOn: string;
  closedOn: string | null;
}

export interface FixtureTransaction {
  id: string;
  positionId: string;
  legId: string;
  action: TradeAction;
  quantity: number;
  premium: number;
  cashFlow: number;
  occurredOn: string;
}

export function tastyOptionSymbol(
  root: string,
  expiration: string,
  optionType: OptionType,
  strike: number,
): string {
  const [year, month, day] = expiration.split('-');
  if (!year || !month || !day) {
    throw new Error(`Invalid expiration ${expiration}`);
  }
  const yymmdd = `${year.slice(2)}${month}${day}`;
  const right = optionType === 'call' ? 'C' : 'P';
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${root} ${yymmdd}${right}${strikeCode}`;
}

export function optionInstrumentKey(tastySymbol: string): string {
  return `option:${tastySymbol.replace(/\s+/g, '')}`;
}

function leg(input: FixtureLeg): FixtureLeg & { instrumentKey: string; tastySymbol: string; isDemo: true } {
  const tastySymbol = tastyOptionSymbol(input.positionId.startsWith('pos_') ? underlyingFromPosition(input.positionId) : '', input.expiration, input.optionType, input.strike);
  return {
    ...input,
    tastySymbol,
    instrumentKey: optionInstrumentKey(tastySymbol),
    isDemo: true,
  };
}

function underlyingFromPosition(positionId: string): string {
  const found = positions.find((position) => position.id === positionId);
  if (!found) {
    throw new Error(`Unknown position ${positionId}`);
  }
  return found.underlying;
}

export const account = {
  id: 'acct_demo',
  provider: 'demo',
  externalId: null as string | null,
  displayName: 'Synthetic Demo Account',
  isDemo: true as const,
  connectionStatus: 'demo-only',
  createdAt: DEMO_AS_OF,
};

export const positions = [
  {
    id: 'pos_nvda',
    accountId: account.id,
    underlying: 'NVDA',
    strategy: 'pmcc' as const,
    status: 'open' as const,
    openedOn: '2026-04-10',
    closedOn: null,
    thesis: 'Demo PMCC. Long Jan 2028 call financed in part by short-call credits.',
    isDemo: true as const,
    createdAt: DEMO_AS_OF,
  },
  {
    id: 'pos_amzn',
    accountId: account.id,
    underlying: 'AMZN',
    strategy: 'pmcc' as const,
    status: 'open' as const,
    openedOn: '2026-05-06',
    closedOn: null,
    thesis: 'Demo PMCC. One short call expired and a later short call is still open.',
    isDemo: true as const,
    createdAt: DEMO_AS_OF,
  },
  {
    id: 'pos_aapl',
    accountId: account.id,
    underlying: 'AAPL',
    strategy: 'leaps' as const,
    status: 'open' as const,
    openedOn: '2026-06-02',
    closedOn: null,
    thesis: 'Demo LEAPS-only call. No short call is paired with it.',
    isDemo: true as const,
    createdAt: DEMO_AS_OF,
  },
  {
    id: 'pos_msft',
    accountId: account.id,
    underlying: 'MSFT',
    strategy: 'leaps' as const,
    status: 'open' as const,
    openedOn: '2026-07-15',
    closedOn: null,
    thesis: 'Demo LEAPS-only call held below its entry mark in this fixture.',
    isDemo: true as const,
    createdAt: DEMO_AS_OF,
  },
];

const legInputs: FixtureLeg[] = [
  {
    id: 'leg_nvda_long',
    positionId: 'pos_nvda',
    side: 'long',
    optionType: 'call',
    strike: 120,
    expiration: '2028-01-21',
    quantity: 1,
    openPremium: 38,
    status: 'open',
    openedOn: '2026-04-10',
    closedOn: null,
  },
  {
    id: 'leg_nvda_sep',
    positionId: 'pos_nvda',
    side: 'short',
    optionType: 'call',
    strike: 170,
    expiration: '2026-09-18',
    quantity: 1,
    openPremium: 4.2,
    status: 'closed',
    openedOn: '2026-08-20',
    closedOn: '2026-09-11',
  },
  {
    id: 'leg_nvda_nov',
    positionId: 'pos_nvda',
    side: 'short',
    optionType: 'call',
    strike: 185,
    expiration: '2026-11-20',
    quantity: 1,
    openPremium: 3.4,
    status: 'open',
    openedOn: '2026-10-01',
    closedOn: null,
  },
  {
    id: 'leg_amzn_long',
    positionId: 'pos_amzn',
    side: 'long',
    optionType: 'call',
    strike: 200,
    expiration: '2028-01-21',
    quantity: 1,
    openPremium: 36.4,
    status: 'open',
    openedOn: '2026-05-06',
    closedOn: null,
  },
  {
    id: 'leg_amzn_aug',
    positionId: 'pos_amzn',
    side: 'short',
    optionType: 'call',
    strike: 230,
    expiration: '2026-08-21',
    quantity: 1,
    openPremium: 3.8,
    status: 'closed',
    openedOn: '2026-07-20',
    closedOn: '2026-08-21',
  },
  {
    id: 'leg_amzn_dec',
    positionId: 'pos_amzn',
    side: 'short',
    optionType: 'call',
    strike: 240,
    expiration: '2026-12-18',
    quantity: 1,
    openPremium: 4.6,
    status: 'open',
    openedOn: '2026-09-21',
    closedOn: null,
  },
  {
    id: 'leg_aapl',
    positionId: 'pos_aapl',
    side: 'long',
    optionType: 'call',
    strike: 200,
    expiration: '2028-01-21',
    quantity: 1,
    openPremium: 42.5,
    status: 'open',
    openedOn: '2026-06-02',
    closedOn: null,
  },
  {
    id: 'leg_msft',
    positionId: 'pos_msft',
    side: 'long',
    optionType: 'call',
    strike: 420,
    expiration: '2028-01-21',
    quantity: 1,
    openPremium: 55,
    status: 'open',
    openedOn: '2026-07-15',
    closedOn: null,
  },
];

export const legs = legInputs.map((input) => leg(input));

const transactionInputs: FixtureTransaction[] = [
  { id: 'txn_nvda_long_open', positionId: 'pos_nvda', legId: 'leg_nvda_long', action: 'buy_to_open', quantity: 1, premium: 38, cashFlow: -3800, occurredOn: '2026-04-10' },
  { id: 'txn_amzn_long_open', positionId: 'pos_amzn', legId: 'leg_amzn_long', action: 'buy_to_open', quantity: 1, premium: 36.4, cashFlow: -3640, occurredOn: '2026-05-06' },
  { id: 'txn_aapl_open', positionId: 'pos_aapl', legId: 'leg_aapl', action: 'buy_to_open', quantity: 1, premium: 42.5, cashFlow: -4250, occurredOn: '2026-06-02' },
  { id: 'txn_amzn_aug_open', positionId: 'pos_amzn', legId: 'leg_amzn_aug', action: 'sell_to_open', quantity: 1, premium: 3.8, cashFlow: 380, occurredOn: '2026-07-20' },
  { id: 'txn_msft_open', positionId: 'pos_msft', legId: 'leg_msft', action: 'buy_to_open', quantity: 1, premium: 55, cashFlow: -5500, occurredOn: '2026-07-15' },
  { id: 'txn_nvda_sep_open', positionId: 'pos_nvda', legId: 'leg_nvda_sep', action: 'sell_to_open', quantity: 1, premium: 4.2, cashFlow: 420, occurredOn: '2026-08-20' },
  { id: 'txn_amzn_aug_expire', positionId: 'pos_amzn', legId: 'leg_amzn_aug', action: 'expire', quantity: 1, premium: 0, cashFlow: 0, occurredOn: '2026-08-21' },
  { id: 'txn_nvda_sep_close', positionId: 'pos_nvda', legId: 'leg_nvda_sep', action: 'buy_to_close', quantity: 1, premium: 1.1, cashFlow: -110, occurredOn: '2026-09-11' },
  { id: 'txn_amzn_dec_open', positionId: 'pos_amzn', legId: 'leg_amzn_dec', action: 'sell_to_open', quantity: 1, premium: 4.6, cashFlow: 460, occurredOn: '2026-09-21' },
  { id: 'txn_nvda_nov_open', positionId: 'pos_nvda', legId: 'leg_nvda_nov', action: 'sell_to_open', quantity: 1, premium: 3.4, cashFlow: 340, occurredOn: '2026-10-01' },
];

export const transactions = transactionInputs.map((transaction) => ({
  ...transaction,
  accountId: account.id,
  isDemo: true as const,
}));

interface MarkInput {
  instrumentKey: string;
  mark: number;
  delta: number | null;
  theta: number | null;
}

const markInputs: MarkInput[] = [
  { instrumentKey: optionInstrumentKey(tastyOptionSymbol('NVDA', '2028-01-21', 'call', 120)), mark: 44.5, delta: 0.72, theta: -0.03 },
  { instrumentKey: optionInstrumentKey(tastyOptionSymbol('NVDA', '2026-11-20', 'call', 185)), mark: 2.15, delta: 0.22, theta: -0.04 },
  { instrumentKey: optionInstrumentKey(tastyOptionSymbol('AMZN', '2028-01-21', 'call', 200)), mark: 33.8, delta: 0.55, theta: -0.02 },
  { instrumentKey: optionInstrumentKey(tastyOptionSymbol('AMZN', '2026-12-18', 'call', 240)), mark: 5.1, delta: 0.31, theta: -0.03 },
  { instrumentKey: optionInstrumentKey(tastyOptionSymbol('AAPL', '2028-01-21', 'call', 200)), mark: 48.1, delta: 0.61, theta: -0.018 },
  { instrumentKey: optionInstrumentKey(tastyOptionSymbol('MSFT', '2028-01-21', 'call', 420)), mark: 51.2, delta: 0.48, theta: -0.02 },
];

export const marks = markInputs.map((input, index) => ({
  id: `mark_${index + 1}`,
  instrumentKey: input.instrumentKey,
  mark: input.mark,
  delta: input.delta,
  gamma: null as number | null,
  theta: input.theta,
  vega: null as number | null,
  iv: null as number | null,
  asOf: DEMO_AS_OF,
  source: 'demo-fixture',
  isDemo: true as const,
}));

export const journalEntries = [
  {
    id: 'journal_nvda_roll',
    positionId: 'pos_nvda',
    title: 'NVDA September short call closed',
    body: 'Demo note. Bought back the Sep 170 call for 1.10 after selling it at 4.20, then sold the Nov 185 call for 3.40. This is not a live recommendation.',
    createdAt: '2026-10-01',
    isDemo: true as const,
  },
  {
    id: 'journal_amzn_expire',
    positionId: 'pos_amzn',
    title: 'AMZN August short call expired',
    body: 'Demo note. The Aug 230 short call expired in this fixture and the credit was kept. A Dec 240 short call was opened afterward.',
    createdAt: '2026-08-21',
    isDemo: true as const,
  },
  {
    id: 'journal_aapl_entry',
    positionId: 'pos_aapl',
    title: 'AAPL LEAPS entry',
    body: 'Demo note. Opened the Jan 2028 200 call as a long-dated holding with no short call attached.',
    createdAt: '2026-06-02',
    isDemo: true as const,
  },
];

export const researchCandidates = [
  {
    id: 'res_googl',
    underlying: 'GOOGL',
    title: 'GOOGL Jan 2028 160 call',
    summary: 'Illustrative long-dated call held in the demo research queue. No order is associated with it.',
    expiration: '2028-01-21',
    strike: 160,
    optionType: 'call' as const,
    illustrativePremium: 29.5,
    criteriaNote: 'Synthetic demo row only. It is not the Sal PMCC — Deep ITM profile and it is not a screen result.',
    createdAt: '2026-10-10',
    isDemo: true as const,
  },
  {
    id: 'res_avgo',
    underlying: 'AVGO',
    title: 'AVGO Jan 2028 280 call',
    summary: 'Illustrative candidate used to show how research notes will appear later.',
    expiration: '2028-01-21',
    strike: 280,
    optionType: 'call' as const,
    illustrativePremium: 46,
    criteriaNote: 'Demo criteria: capital for one contract stays inside a sample budget. Not a live quote.',
    createdAt: '2026-10-11',
    isDemo: true as const,
  },
  {
    id: 'res_meta',
    underlying: 'META',
    title: 'META Jan 2028 480 call',
    summary: 'Illustrative candidate with a wider premium so the queue is not a single template.',
    expiration: '2028-01-21',
    strike: 480,
    optionType: 'call' as const,
    illustrativePremium: 71,
    criteriaNote: 'Demo criteria: waiting on a pullback before any future workflow would consider it.',
    createdAt: '2026-10-12',
    isDemo: true as const,
  },
];

export const alerts = [
  {
    id: 'alert_amzn_tested',
    positionId: 'pos_amzn',
    severity: 'warning' as const,
    title: 'AMZN short call is above its credit',
    message: 'Demo alert. The Dec 2026 240 call mark is 5.10 against a 4.60 credit in this fixture. No close or roll will be sent.',
    createdAt: '2026-10-15',
    isDemo: true as const,
  },
  {
    id: 'alert_nvda_expiry',
    positionId: 'pos_nvda',
    severity: 'attention' as const,
    title: 'NVDA short call expires in 36 days',
    message: 'Demo alert. The Nov 20, 2026 185 call is inside the 90-day review window of the Oct 15, 2026 snapshot.',
    createdAt: '2026-10-15',
    isDemo: true as const,
  },
  {
    id: 'alert_msft_underwater',
    positionId: 'pos_msft',
    severity: 'info' as const,
    title: 'MSFT LEAPS mark is below entry',
    message: 'Demo alert. The Jan 2028 420 call mark is 51.20 against a 55.00 entry. This fixture does not recommend an action.',
    createdAt: '2026-10-14',
    isDemo: true as const,
  },
];

export const watchlist = [
  {
    id: 'watch_googl',
    underlying: 'GOOGL',
    note: 'Demo watch. Overlaps the research queue. The last price is a fixture.',
    demoLast: 180,
    sortOrder: 1,
    isDemo: true as const,
  },
  {
    id: 'watch_avgo',
    underlying: 'AVGO',
    note: 'Demo watch. Illustrative last price only.',
    demoLast: 300,
    sortOrder: 2,
    isDemo: true as const,
  },
  {
    id: 'watch_meta',
    underlying: 'META',
    note: 'Demo watch. Illustrative last price only.',
    demoLast: 500,
    sortOrder: 3,
    isDemo: true as const,
  },
  {
    id: 'watch_spy',
    underlying: 'SPY',
    note: 'Demo benchmark row. Not a position and not a live index value.',
    demoLast: 550,
    sortOrder: 4,
    isDemo: true as const,
  },
];

export function fixtureSnapshot(): {
  accountName: string;
  positions: typeof positions;
  legs: typeof legs;
  transactions: typeof transactions;
  marks: typeof marks;
  journalEntries: typeof journalEntries;
  researchCandidates: typeof researchCandidates;
  alerts: typeof alerts;
  watchlist: typeof watchlist;
} {
  return {
    accountName: account.displayName,
    positions,
    legs,
    transactions,
    marks,
    journalEntries,
    researchCandidates,
    alerts,
    watchlist,
  };
}
