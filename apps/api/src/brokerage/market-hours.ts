export type QuoteFreshness = 'missing' | 'fresh' | 'stale' | 'closed_session';

const FRESH_MS = 15 * 60 * 1000;

function newYorkParts(instant: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return { weekday, minutes: hour * 60 + minute };
}

/**
 * New York date (YYYY-MM-DD) of the most recent regular-session open at or before `instant`.
 * Friday-evening and weekend observations both map to Friday. Exchange holidays are not modeled,
 * so a holiday observation is conservatively treated as its own session.
 */
export function tradingSessionKey(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const date = new Date(Date.UTC(value('year'), value('month') - 1, value('day'), 12));
  const { minutes } = newYorkParts(instant);
  const isWeekday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  if (!(isWeekday(date) && minutes >= 9 * 60 + 30)) {
    do {
      date.setUTCDate(date.getUTCDate() - 1);
    } while (!isWeekday(date));
  }
  return date.toISOString().slice(0, 10);
}

export function isRegularUsEquitySession(instant: Date): boolean {
  const { weekday, minutes } = newYorkParts(instant);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function classifyQuoteFreshness(quoteAsOf: string | null, observedAt: Date): QuoteFreshness {
  if (!quoteAsOf) {
    return 'missing';
  }
  const asOf = new Date(quoteAsOf);
  if (Number.isNaN(asOf.getTime())) {
    return 'missing';
  }
  if (!isRegularUsEquitySession(observedAt)) {
    return 'closed_session';
  }
  return observedAt.getTime() - asOf.getTime() <= FRESH_MS ? 'fresh' : 'stale';
}
