import { describe, expect, it } from 'vitest';
import { parseMinExpirationDays, parseOptionalMoney, parseRequiredMoney } from './ruleFields';

describe('rule field parsing', () => {
  it('rejects values that would otherwise become NaN', () => {
    expect(parseOptionalMoney('abc')).toEqual({ value: null, error: 'Enter a dollar amount such as 8 or 8.00.' });
    expect(parseOptionalMoney('NaN').value).toBeNull();
    expect(parseRequiredMoney('', 'Maximum cost').error).toMatch(/required/i);
  });

  it('accepts blank optional money and normalizes decimals', () => {
    expect(parseOptionalMoney('')).toEqual({ value: null, error: null });
    expect(parseOptionalMoney('8')).toEqual({ value: '8.00', error: null });
    expect(parseOptionalMoney('0')).toEqual({ value: '0.00', error: null });
  });

  it('allows zero days until expiration', () => {
    expect(parseMinExpirationDays('0')).toEqual({ value: 0, error: null });
    expect(parseMinExpirationDays('365').value).toBe(365);
    expect(parseMinExpirationDays('-1').error).toMatch(/whole number/);
  });
});
