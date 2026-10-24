export interface ParsedMoney {
  value: string | null;
  error: string | null;
}

const moneyPattern = /^\d+(\.\d{1,4})?$/;

export function parseOptionalMoney(value: string): ParsedMoney {
  const trimmed = value.trim();
  if (trimmed === '') return { value: null, error: null };
  if (!moneyPattern.test(trimmed)) {
    return { value: null, error: 'Enter a dollar amount such as 8 or 8.00.' };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return { value: null, error: 'Enter a dollar amount such as 8 or 8.00.' };
  }
  return { value: amount.toFixed(2), error: null };
}

export function parseRequiredMoney(value: string, label: string): ParsedMoney {
  const parsed = parseOptionalMoney(value);
  if (parsed.error) return parsed;
  if (parsed.value == null) return { value: null, error: `${label} is required.` };
  return parsed;
}

export function parseMinExpirationDays(value: string): { value: number | null; error: string | null } {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: 'Enter 0 or a whole number of days.' };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5000) {
    return { value: null, error: 'Enter 0 or a whole number of days.' };
  }
  return { value: parsed, error: null };
}
