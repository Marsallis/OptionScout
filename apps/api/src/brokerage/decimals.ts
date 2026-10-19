const INTEGER_ID_KEYS = new Set(['id', 'transaction-id']);

const DECIMAL_KEYS = new Set([
  'quantity',
  'average-open-price',
  'close-price',
  'mark',
  'mark-price',
  'multiplier',
  'price',
  'value',
  'net-value',
  'commission',
  'clearing-fees',
  'regulatory-fees',
  'proprietary-index-option-fees',
  'other-fees',
  'bid',
  'ask',
  'mid',
  'last',
]);

export function parseBrokerJson(text: string): unknown {
  const quoted = text.replace(/("(?:[^"\\]|\\.)*")\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (match, key: string, num: string) => {
    const name = JSON.parse(key) as string;
    if (INTEGER_ID_KEYS.has(name) && /^-?\d+$/.test(num)) {
      return `${key}: "${num}"`;
    }
    if (DECIMAL_KEYS.has(name)) {
      return `${key}: "${num}"`;
    }
    return match;
  });
  return JSON.parse(quoted) as unknown;
}

export function asDecimalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}
