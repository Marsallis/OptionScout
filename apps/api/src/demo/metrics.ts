import {
  DEMO_AS_OF,
  DEMO_DISCLAIMER,
  UPCOMING_EXPIRATION_DAYS,
  type Dashboard,
  type LegView,
} from '@optionscout/shared';
import {
  fixtureSnapshot,
  type FixtureTransaction,
  type OptionSide,
  type OptionType,
  type TradeAction,
} from './fixtures.js';

export interface PortfolioSnapshot {
  accountName: string;
  positions: Array<{
    id: string;
    underlying: string;
    strategy: 'leaps' | 'pmcc';
    status: 'open' | 'closed';
    openedOn: string;
    thesis: string;
    isDemo: boolean;
  }>;
  legs: Array<{
    id: string;
    positionId: string;
    side: OptionSide;
    optionType: OptionType;
    strike: number;
    expiration: string;
    quantity: number;
    openPremium: number;
    status: 'open' | 'closed';
    instrumentKey: string;
    tastySymbol: string;
    isDemo: boolean;
  }>;
  transactions: Array<{
    id: string;
    positionId: string;
    legId: string;
    action: TradeAction;
    quantity: number;
    premium: number;
    cashFlow: number;
    occurredOn: string;
    isDemo: boolean;
  }>;
  marks: Array<{
    instrumentKey: string;
    mark: number;
    delta: number | null;
    theta: number | null;
    asOf: string;
    source: string;
    isDemo: boolean;
  }>;
  journalEntries: Array<{
    id: string;
    positionId: string | null;
    title: string;
    body: string;
    createdAt: string;
    isDemo: boolean;
  }>;
  researchCandidates: Array<{
    id: string;
    underlying: string;
    title: string;
    summary: string;
    expiration: string;
    strike: number;
    optionType: OptionType;
    illustrativePremium: number;
    criteriaNote: string;
    isDemo: boolean;
  }>;
  alerts: Array<{
    id: string;
    positionId: string | null;
    severity: 'info' | 'attention' | 'warning';
    title: string;
    message: string;
    isDemo: boolean;
  }>;
  watchlist: Array<{
    id: string;
    underlying: string;
    note: string;
    demoLast: number;
    sortOrder: number;
    isDemo: boolean;
  }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface PortfolioMark {
  instrumentKey: string;
  mark: number;
  delta: number | null;
  theta: number | null;
  asOf: string;
  source: string;
  isDemo: boolean;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function daysBetween(asOfIso: string, expiration: string): number {
  const start = Date.parse(`${asOfIso.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${expiration}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function formatContract(expiration: string, strike: number, optionType: OptionType): string {
  const [year, month, day] = expiration.split('-').map(Number);
  const monthLabel = MONTHS[(month ?? 1) - 1] ?? 'Jan';
  const typeLabel = optionType === 'call' ? 'Call' : 'Put';
  return `${monthLabel} ${day}, ${year} ${strike} ${typeLabel}`;
}

export function unrealizedPnl(side: OptionSide, openPremium: number, mark: number, quantity: number): number {
  const difference = side === 'long' ? mark - openPremium : openPremium - mark;
  return roundMoney(difference * quantity * 100);
}

function assertDemo(isDemo: boolean, label: string): true {
  if (!isDemo) {
    throw new Error(`Refusing to project a non-demo ${label} in Phase 1A.`);
  }
  return true;
}

function legTransactions(legId: string, ledger: FixtureTransaction[]): FixtureTransaction[] {
  return ledger.filter((transaction) => transaction.legId === legId);
}

export function projectDashboard(snapshot: PortfolioSnapshot = fixtureSnapshot(), asOf: string = DEMO_AS_OF): Dashboard {
  const { marks, positions, legs, transactions, watchlist, researchCandidates, alerts, journalEntries, accountName } = snapshot;
  const markByKey = new Map(marks.map((mark) => [mark.instrumentKey, mark]));
  const positionById = new Map(positions.map((position) => [position.id, position]));

  const positionViews = [...positions]
    .sort((left, right) => left.openedOn.localeCompare(right.openedOn) || left.underlying.localeCompare(right.underlying))
    .map((position) => {
      assertDemo(position.isDemo, 'position');
      const positionLegs = legs.filter((item) => item.positionId === position.id);
      const legViews: LegView[] = positionLegs.map((item) => {
        assertDemo(item.isDemo, 'leg');
        const mark = item.status === 'open' ? markByKey.get(item.instrumentKey) : undefined;
        if (item.status === 'open' && !mark) {
          throw new Error(`Open demo leg ${item.id} is missing a fixture mark.`);
        }
        if (mark) {
          assertDemo(mark.isDemo, 'mark');
        }
        const daysToExpiration = daysBetween(asOf, item.expiration);
        return {
          id: item.id,
          side: item.side,
          optionType: item.optionType,
          strike: item.strike,
          expiration: item.expiration,
          quantity: item.quantity,
          openPremium: item.openPremium,
          status: item.status,
          instrumentKey: item.instrumentKey,
          tastySymbol: item.tastySymbol,
          mark: mark ? mark.mark : null,
          delta: mark?.delta ?? null,
          theta: mark?.theta ?? null,
          daysToExpiration,
          unrealizedPnl: mark ? unrealizedPnl(item.side, item.openPremium, mark.mark, item.quantity) : null,
          isDemo: true,
        };
      });

      const positionTx = transactions.filter((transaction) => transaction.positionId === position.id);
      const leapsCapital = roundMoney(
        positionLegs
          .filter((item) => item.status === 'open' && item.side === 'long')
          .reduce((sum, item) => {
            const opening = legTransactions(item.id, positionTx).filter((transaction) => transaction.action === 'buy_to_open');
            return sum + opening.reduce((cash, transaction) => cash + Math.abs(transaction.cashFlow), 0);
          }, 0),
      );
      const shortCallCredits = roundMoney(
        positionLegs
          .filter((item) => item.side === 'short' && item.optionType === 'call')
          .reduce((sum, item) => {
            const credits = legTransactions(item.id, positionTx)
              .filter((transaction) => transaction.action === 'sell_to_open')
              .reduce((cash, transaction) => cash + transaction.cashFlow, 0);
            return sum + credits;
          }, 0),
      );
      const realizedPnl = roundMoney(
        positionLegs
          .filter((item) => item.status === 'closed')
          .reduce((sum, item) => sum + legTransactions(item.id, positionTx).reduce((cash, transaction) => cash + transaction.cashFlow, 0), 0),
      );
      const estimatedUnrealizedPnl = roundMoney(
        legViews.reduce((sum, item) => sum + (item.unrealizedPnl ?? 0), 0),
      );
      const openLegs = legViews.filter((item) => item.status === 'open');
      const netDelta = openLegs.every((item) => item.delta !== null)
        ? roundMoney(
            openLegs.reduce((sum, item) => sum + (item.delta ?? 0) * item.quantity * (item.side === 'long' ? 1 : -1), 0),
          )
        : null;
      const structure = openLegs
        .map((item) => `${item.side === 'long' ? 'Long' : 'Short'} ${formatContract(item.expiration, item.strike, item.optionType)}`)
        .join(' · ');
      const closedShorts = legViews.filter((item) => item.status === 'closed' && item.side === 'short');
      const closedShortSummary = closedShorts.length
        ? `Closed short: ${closedShorts.map((item) => formatContract(item.expiration, item.strike, item.optionType)).join('; ')}`
        : null;

      return {
        id: position.id,
        underlying: position.underlying,
        strategy: position.strategy,
        status: position.status,
        openedOn: position.openedOn,
        thesis: position.thesis,
        structure,
        closedShortSummary,
        isDemo: true as const,
        legs: legViews,
        leapsCapital,
        shortCallCredits,
        realizedPnl,
        estimatedUnrealizedPnl,
        netDelta,
      };
    });

  const transactionViews = [...transactions]
    .sort((left, right) => left.occurredOn.localeCompare(right.occurredOn) || left.id.localeCompare(right.id))
    .map((transaction) => {
      assertDemo(transaction.isDemo, 'transaction');
      const legRecord = legs.find((item) => item.id === transaction.legId);
      const position = positionById.get(transaction.positionId);
      if (!legRecord || !position) {
        throw new Error(`Transaction ${transaction.id} is missing its leg or position.`);
      }
      return {
        id: transaction.id,
        positionId: transaction.positionId,
        underlying: position.underlying,
        action: transaction.action as TradeAction,
        occurredOn: transaction.occurredOn,
        premium: transaction.premium,
        quantity: transaction.quantity,
        cashFlow: transaction.cashFlow,
        optionSummary: formatContract(legRecord.expiration, legRecord.strike, legRecord.optionType),
        isDemo: true as const,
      };
    });

  const upcomingExpirations = positionViews
    .flatMap((position) =>
      position.legs
        .filter((item) => item.status === 'open')
        .filter((item) => item.daysToExpiration >= 0 && item.daysToExpiration <= UPCOMING_EXPIRATION_DAYS)
        .map((item) => ({
          legId: item.id,
          underlying: position.underlying,
          side: item.side,
          optionType: item.optionType,
          strike: item.strike,
          expiration: item.expiration,
          daysToExpiration: item.daysToExpiration,
          isDemo: true as const,
        })),
    )
    .sort((left, right) => left.daysToExpiration - right.daysToExpiration);

  const summary = {
    openPositions: positionViews.filter((position) => position.status === 'open').length,
    leapsCapital: roundMoney(positionViews.reduce((sum, position) => sum + position.leapsCapital, 0)),
    shortCallCreditsReceived: roundMoney(positionViews.reduce((sum, position) => sum + position.shortCallCredits, 0)),
    realizedPnl: roundMoney(positionViews.reduce((sum, position) => sum + position.realizedPnl, 0)),
    estimatedUnrealizedPnl: roundMoney(positionViews.reduce((sum, position) => sum + position.estimatedUnrealizedPnl, 0)),
    upcomingExpirationCount: upcomingExpirations.length,
  };

  return {
    demo: true,
    dataSource: 'demo-fixture',
    disclaimer: DEMO_DISCLAIMER,
    asOf,
    phase: '1C',
    brokerage: {
      providerId: 'demo',
      connectionStatus: 'demo-only',
      accountName,
      liveCredentialsRequired: false,
      oauthImplemented: false,
      streamingImplemented: false,
      ordersEnabled: false,
      label: 'Not connected to a brokerage. Showing the synthetic demo account.',
    },
    summary,
    positions: positionViews,
    transactions: transactionViews,
    upcomingExpirations,
    watchlist: [...watchlist]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((item) => ({
        id: item.id,
        underlying: item.underlying,
        note: item.note,
        demoLast: item.demoLast,
        isDemo: true as const,
      })),
    research: researchCandidates.map((item) => ({
      id: item.id,
      underlying: item.underlying,
      title: item.title,
      summary: item.summary,
      expiration: item.expiration,
      strike: item.strike,
      optionType: item.optionType,
      illustrativePremium: item.illustrativePremium,
      criteriaNote: item.criteriaNote,
      isDemo: true as const,
    })),
    alerts: [...alerts]
      .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
      .map((item) => ({
        id: item.id,
        positionId: item.positionId,
        severity: item.severity,
        title: item.title,
        message: item.message,
        isDemo: true as const,
      })),
    journal: [...journalEntries]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((item) => ({
        id: item.id,
        positionId: item.positionId,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
        isDemo: true as const,
      })),
  };
}

function severityRank(severity: 'info' | 'attention' | 'warning'): number {
  if (severity === 'warning') return 0;
  if (severity === 'attention') return 1;
  return 2;
}

export function quoteRecords(snapshot: PortfolioSnapshot = fixtureSnapshot()): PortfolioMark[] {
  return snapshot.marks.map((mark) => ({
    instrumentKey: mark.instrumentKey,
    mark: mark.mark,
    delta: mark.delta,
    theta: mark.theta,
    asOf: mark.asOf,
    source: mark.source,
    isDemo: mark.isDemo,
  }));
}
