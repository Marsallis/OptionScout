import type { Portfolio, PortfolioPosition } from '@optionscout/shared';

export type SnapshotTone = 'neutral' | 'positive' | 'negative' | 'warning';

export type SnapshotCard = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: SnapshotTone;
};

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning';
  action: 'positions' | 'health' | 'confirm';
  suggestionKey?: string;
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function formatPortfolioMoney(value: string | null): string {
  if (value == null) return 'Unavailable';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'Unavailable';
  return money.format(parsed);
}

export function sumKnown(values: Array<string | null | undefined>): { total: string | null; omitted: number; present: number } {
  let total = 0;
  let omitted = 0;
  let present = 0;
  for (const value of values) {
    if (value == null || value === '') {
      omitted += 1;
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return { total: null, omitted, present };
    total += parsed;
    present += 1;
  }
  return { total: present > 0 ? total.toFixed(2) : null, omitted, present };
}

function openLegs(portfolio: Portfolio): PortfolioPosition[] {
  return portfolio.positions.filter((position) => position.direction !== 'flat');
}

function freshnessPhrase(positions: PortfolioPosition[]): string {
  if (positions.length === 0) return 'No open option quotes to show.';
  if (positions.some((position) => position.quoteFreshness === 'missing' || position.quoteFreshness === 'unavailable')) {
    return 'Some quotes are missing. Figures that need them are withheld.';
  }
  if (positions.some((position) => position.quoteFreshness === 'stale' || position.quoteFreshness === 'closed_session')) {
    return 'Some prices are from a previous market session, not a live quote.';
  }
  if (positions.every((position) => position.quoteFreshness === 'fresh')) return 'Quotes were observed in the current session.';
  return 'Quote freshness is mixed. Check Data Health before treating a figure as current.';
}

/** Calendar days from a date to an expiration. This is not the stored snapshot countdown. */
export function calendarDaysUntil(expiration: string, todayIso: string): number | null {
  const end = Date.parse(`${expiration.slice(0, 10)}T00:00:00Z`);
  const start = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function localDateIso(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function portfolioStatusLine(portfolio: Portfolio): { title: string; detail: string } {
  const when = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(portfolio.asOf));
  return {
    title: `Portfolio snapshot — ${when}`,
    detail: freshnessPhrase(openLegs(portfolio)),
  };
}

export function buildSnapshot(portfolio: Portfolio, todayIso = localDateIso()): SnapshotCard[] {
  const open = openLegs(portfolio);
  const longs = open.filter((position) => position.direction === 'long' && position.optionRight === 'call');
  const basis = sumKnown(longs.map((position) => position.remainingBasis));
  const value = sumKnown(longs.map((position) => position.marketValue));
  const unrealized = sumKnown(open.map((position) => position.unrealized));
  const currentQuotes = open.length > 0 && open.every((position) => position.quoteFreshness === 'fresh');
  const partialRealized =
    portfolio.realizedAudit.label.toLowerCase().includes('partial') ||
    portfolio.realizedAudit.unknownFeeCount > 0 ||
    !portfolio.history.accountingComplete;
  const nearest = open
    .map((position) => ({ position, days: position.expiration ? calendarDaysUntil(position.expiration, todayIso) : null }))
    .filter((row) => row.days != null && row.days >= 0 && row.days <= 90)
    .sort((left, right) => (left.days ?? 9999) - (right.days ?? 9999))[0];

  return [
    {
      id: 'strategies',
      label: 'Active strategies',
      value: String(portfolio.strategies.length),
      detail:
        portfolio.strategies.length === 1
          ? '1 confirmed PMCC. Open legs are counted separately below.'
          : `${portfolio.strategies.length} confirmed PMCCs. Unconfirmed pairs are not included.`,
      tone: 'neutral',
    },
    {
      id: 'basis',
      label: 'Long-call remaining basis',
      value: basis.omitted > 0 && basis.present === 0 ? 'Unavailable' : formatPortfolioMoney(basis.total),
      detail:
        basis.omitted > 0
          ? `Partial. ${basis.omitted} long ${basis.omitted === 1 ? 'call has' : 'calls have'} no known-fee remaining basis. This is not total account capital.`
          : 'Known-fee cost still open on long calls only. This is not total account capital.',
      tone: basis.omitted > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'value',
      label: 'Long-call mark value',
      value: value.omitted > 0 && value.present === 0 ? 'Unavailable' : formatPortfolioMoney(value.total),
      detail:
        value.omitted > 0
          ? `Partial. ${value.omitted} long ${value.omitted === 1 ? 'call has' : 'calls have'} no brokerage mark. This is not total portfolio value.`
          : 'Brokerage REST mark on long calls only. Short-call marks are not added into this card.',
      tone: value.omitted > 0 || !currentQuotes ? 'warning' : 'neutral',
    },
    {
      id: 'unrealized',
      label: 'Unrealized P/L — open calls',
      value: unrealized.omitted > 0 ? 'Partial' : formatPortfolioMoney(unrealized.total),
      detail: unrealized.omitted > 0
        ? `Covers long and short open calls. ${unrealized.omitted} ${unrealized.omitted === 1 ? 'leg was' : 'legs were'} omitted because the mark or basis is missing.`
        : currentQuotes
          ? 'Long and short open calls, each using its brokerage REST mark. Not a return percentage.'
          : 'Long and short open calls, each using its brokerage REST mark. Not a current-market result.',
      tone: unrealized.omitted > 0 || !currentQuotes ? 'warning' : toneFor(unrealized.total),
    },
    {
      id: 'realized',
      label: partialRealized ? 'Realized P/L — Needs reconciliation' : 'Reconstructed realized results',
      value: partialRealized ? 'Partial' : formatPortfolioMoney(portfolio.realizedAudit.totalIncluded),
      detail: partialRealized
        ? 'The partial dollar figure is in Advanced Portfolio Details. It is not verified lifetime profit.'
        : 'Closed reconstructed option cycles only. Opening short-call credits are not included.',
      tone: partialRealized ? 'warning' : 'neutral',
    },
    {
      id: 'expiration',
      label: 'Next expiration',
      value: nearest?.days != null ? `${nearest.days} days from today` : 'None inside 90 days',
      detail: nearest
        ? `${nearest.position.underlying} ${nearest.position.direction} call expires ${nearest.position.expiration}. Counted from ${todayIso}, not from the quote snapshot.`
        : 'No open contract in the 90-day window counted from today.',
      tone: nearest && (nearest.days ?? 99) <= 21 ? 'warning' : 'neutral',
    },
  ];
}

function toneFor(value: string | null): SnapshotTone {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return 'neutral';
  return parsed > 0 ? 'positive' : 'negative';
}

export function buildAttention(portfolio: Portfolio, todayIso = localDateIso()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const open = openLegs(portfolio);
  for (const position of open) {
    if (!position.expiration) continue;
    const days = calendarDaysUntil(position.expiration, todayIso);
    if (days == null || days < 0 || days > 45) continue;
    const role = position.direction === 'short' ? 'short call' : 'long call';
    items.push({
      id: `exp-${position.id}`,
      title: `${position.underlying} ${role} expires in ${days} days from today.`,
      detail: `Expiration ${position.expiration}. This countdown uses today's date, not the quote snapshot, and it is not a trading instruction.`,
      severity: days <= 21 ? 'warning' : 'info',
      action: 'positions',
    });
  }
  if (open.some((position) => position.quoteFreshness === 'stale' || position.quoteFreshness === 'closed_session')) {
    items.push({
      id: 'stale-quotes',
      title: 'Some position values use an older market observation.',
      detail: 'A stale or previous-session quote is not a confirmed current-market gain or loss.',
      severity: 'info',
      action: 'health',
    });
  }
  if (portfolio.health.quotesUnavailable > 0 || open.some((position) => position.quoteFreshness === 'missing' || position.quoteFreshness === 'unavailable')) {
    items.push({
      id: 'missing-quotes',
      title: 'At least one open position has no usable quote.',
      detail: 'Missing quotes are left blank. They are not treated as a zero value.',
      severity: 'warning',
      action: 'health',
    });
  }
  if (portfolio.health.missingOpenings > 0 || portfolio.health.unreconciled > 0 || !portfolio.history.accountingComplete) {
    items.push({
      id: 'accounting',
      title: 'Some position accounting is incomplete.',
      detail: `${portfolio.health.missingOpenings} missing openings · ${portfolio.health.unreconciled} unreconciled. Related profit figures stay qualified.`,
      severity: 'warning',
      action: 'health',
    });
  }
  for (const suggestion of portfolio.suggestions) {
    items.push({
      id: `suggest-${suggestion.longSymbol}-${suggestion.shortSymbol}`,
      title: `${suggestion.underlying} has a possible PMCC that is not confirmed.`,
      detail: suggestion.reason,
      severity: 'info',
      action: suggestion.ambiguous ? 'positions' : 'confirm',
      suggestionKey: `${suggestion.longSymbol}-${suggestion.shortSymbol}`,
    });
  }
  return items;
}
