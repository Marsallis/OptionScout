import { describe, expect, it } from 'vitest';
import { discoveryToleranceSchema, normalizeExploratoryDelta, SHOW_PROFILE_MISSES } from './discovery.js';

describe('exploratory delta normalization', () => {
  it('accepts blank, leading-dot, and standard forms', () => {
    expect(normalizeExploratoryDelta('')).toEqual({ ok: true, value: null });
    expect(normalizeExploratoryDelta('   ')).toEqual({ ok: true, value: null });
    expect(normalizeExploratoryDelta('.80')).toEqual({ ok: true, value: '0.80' });
    expect(normalizeExploratoryDelta('0.80')).toEqual({ ok: true, value: '0.80' });
    expect(normalizeExploratoryDelta('0.65')).toEqual({ ok: true, value: '0.65' });
    expect(normalizeExploratoryDelta('0.75')).toEqual({ ok: true, value: '0.75' });
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(normalizeExploratoryDelta('1.5').ok).toBe(false);
    expect(normalizeExploratoryDelta('-0.1').ok).toBe(false);
    expect(normalizeExploratoryDelta('abc').ok).toBe(false);
    expect(normalizeExploratoryDelta('0.12345').ok).toBe(false);
  });

  it('parses tolerance schema with leading-dot delta without changing the saved profile flag', () => {
    const parsed = discoveryToleranceSchema.parse({
      ...SHOW_PROFILE_MISSES,
      minLongDelta: '.80',
    });
    expect(parsed.minLongDelta).toBe('0.80');
    expect(parsed.loosensSavedProfile).toBe(false);
  });
});
