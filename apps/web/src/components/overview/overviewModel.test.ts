import { describe, expect, it } from 'vitest';
import type { Portfolio } from '@optionscout/shared';
import { buildAttention, buildSnapshot, calendarDaysUntil, sumKnown } from './overviewModel';

const portfolio = {
  asOf: '2026-10-15T20:35:00.000Z',
  history: { accountingComplete: false },
  health: { missingOpenings: 0, unreconciled: 1, quotesUnavailable: 0 },
  suggestions: [],
  strategies: [],
  realizedAudit: { label: 'Reconstructed realized results — partial accounting', unknownFeeCount: 1, totalIncluded: '34.00' },
  positions: [
    {
      id: 'long',
      underlying: 'CVX',
      symbol: 'CVX long',
      optionRight: 'call',
      direction: 'long',
      expiration: '2028-01-21',
      daysRemaining: 400,
      strike: '155',
      remainingBasis: '6301.12',
      marketValue: null,
      unrealized: null,
      quoteFreshness: 'closed_session',
      status: 'partial',
    },
  ],
} as unknown as Portfolio;

describe('overview snapshot labels', () => {
  it('does not turn a missing mark into zero or a partial realized total into verified profit', () => {
    const cards = buildSnapshot(portfolio);
    const value = cards.find((card) => card.id === 'value');
    const realized = cards.find((card) => card.id === 'realized');
    const unrealized = cards.find((card) => card.id === 'unrealized');
    expect(value?.value).toBe('Unavailable');
    expect(value?.detail).toMatch(/not total portfolio value/i);
    expect(realized?.label).toBe('Realized P/L — Needs reconciliation');
    expect(realized?.value).toBe('Partial');
    expect(realized?.detail).toMatch(/not verified lifetime profit/i);
    expect(unrealized?.value).toBe('Partial');
    expect(unrealized?.detail).toMatch(/omitted/i);
    expect(value?.value).not.toBe('$0.00');
    expect(JSON.stringify(cards)).not.toContain('34.00');
  });

  it('counts expiration from today and keeps the quote snapshot separate', () => {
    expect(calendarDaysUntil('2026-10-30', '2026-10-15')).toBe(15);
    expect(calendarDaysUntil('2026-10-30', '2026-10-19')).toBe(11);
    expect(calendarDaysUntil('2026-10-30', '2026-10-30')).toBe(0);
    expect(calendarDaysUntil('2026-10-30', '2026-10-31')).toBe(-1);
    expect(calendarDaysUntil('not-a-date', '2026-10-19')).toBeNull();
    const dated = {
      ...portfolio,
      asOf: '2026-10-15T20:35:00.000Z',
      positions: [
        {
          ...portfolio.positions[0],
          id: 'short',
          direction: 'short',
          expiration: '2026-10-30',
          daysRemaining: 15,
        },
      ],
    } as unknown as Portfolio;
    const cards = buildSnapshot(dated, '2026-10-19');
    const expiration = cards.find((card) => card.id === 'expiration');
    expect(expiration?.value).toBe('11 days from today');
    expect(expiration?.detail).toMatch(/not from the quote snapshot/);
    expect(expiration?.value).not.toBe('15 days');
    const attention = buildAttention(dated, '2026-10-19');
    expect(attention.some((item) => item.title.includes('11 days from today'))).toBe(true);
    expect(attention.some((item) => item.title.includes('15 days'))).toBe(false);
    expect(buildAttention(dated, '2026-10-31').some((item) => item.id.startsWith('exp-'))).toBe(false);
    expect(buildSnapshot(dated, '2026-10-30').find((card) => card.id === 'expiration')?.value).toBe('0 days from today');
  });

  it('counts omitted basis instead of pretending the sum is complete', () => {
    expect(sumKnown(['10.00', null])).toEqual({ total: '10.00', omitted: 1, present: 1 });
    expect(buildAttention(portfolio).some((item) => item.title.includes('older market observation'))).toBe(true);
  });
});
