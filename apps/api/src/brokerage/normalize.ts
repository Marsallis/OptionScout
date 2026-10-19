import { Decimal } from 'decimal.js';
import { asDecimalString } from './decimals.js';

const OCC = /^([A-Z]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export type PositionDirection = 'long' | 'short' | 'zero';
export type TransactionClassification = 'trade' | 'expiration' | 'assignment' | 'exercise' | 'transfer' | 'unsupported';

export interface NormalizedPosition {
  providerSymbol: string;
  underlyingSymbol: string;
  optionSymbol: string | null;
  instrumentType: string;
  quantity: string;
  direction: PositionDirection;
  strike: string | null;
  expiration: string | null;
  averageOpenPrice: string | null;
  multiplier: string;
  reportedMark: string | null;
  raw: Record<string, unknown>;
}

export interface NormalizedTransaction {
  providerTransactionId: string;
  symbol: string | null;
  instrumentType: string | null;
  action: string | null;
  quantity: string | null;
  price: string | null;
  executedAt: string | null;
  grossValue: string | null;
  valueEffect: string | null;
  commission: string | null;
  feesJson: string;
  transactionType: string | null;
  transactionSubtype: string | null;
  classification: TransactionClassification;
  raw: Record<string, unknown>;
}

export function parseOccSymbol(symbol: string): { expiration: string; strike: string } | null {
  const match = OCC.exec(symbol.trim());
  if (!match) {
    return null;
  }
  const year = match[2];
  const month = match[3];
  const day = match[4];
  const strikeCode = match[6];
  if (!year || !month || !day || !strikeCode) {
    return null;
  }
  return {
    expiration: `20${year}-${month}-${day}`,
    strike: new Decimal(strikeCode).div(1000).toString(),
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function directionOf(value: unknown): PositionDirection | null {
  if (value === 'Long') return 'long';
  if (value === 'Short') return 'short';
  if (value === 'Zero') return 'zero';
  return null;
}

export function normalizePosition(raw: unknown): NormalizedPosition {
  if (!raw || typeof raw !== 'object') {
    throw new Error('A position payload was empty.');
  }
  const record = raw as Record<string, unknown>;
  const providerSymbol = text(record.symbol);
  const underlyingSymbol = text(record['underlying-symbol']);
  const instrumentType = text(record['instrument-type']);
  const quantity = asDecimalString(record.quantity);
  const direction = directionOf(record['quantity-direction']);
  const multiplier = asDecimalString(record.multiplier);
  if (!providerSymbol || !underlyingSymbol || !instrumentType || !quantity || !direction || !multiplier) {
    throw new Error('A position was missing its symbol, direction, quantity, or multiplier.');
  }
  const parsed = instrumentType === 'Equity Option' ? parseOccSymbol(providerSymbol) : null;
  const expiresAt = text(record['expires-at']);
  return {
    providerSymbol,
    underlyingSymbol,
    optionSymbol: instrumentType === 'Equity Option' ? providerSymbol : null,
    instrumentType,
    quantity,
    direction,
    strike: parsed?.strike ?? null,
    expiration: parsed?.expiration ?? (expiresAt ? expiresAt.slice(0, 10) : null),
    averageOpenPrice: asDecimalString(record['average-open-price']),
    multiplier,
    reportedMark: asDecimalString(record.mark) ?? asDecimalString(record['mark-price']),
    raw: protectedProviderRecord(record),
  };
}

export function classifyTransaction(input: {
  type: string | null;
  subtype: string | null;
  action: string | null;
}): TransactionClassification {
  const blob = `${input.type ?? ''} ${input.subtype ?? ''} ${input.action ?? ''}`.toLowerCase();
  if (blob.includes('assignment')) return 'assignment';
  if (blob.includes('exercise')) return 'exercise';
  if (blob.includes('expir')) return 'expiration';
  if (blob.includes('transfer') || blob.includes('acat') || blob.includes('receive') || blob.includes('deliver')) {
    return 'transfer';
  }
  if ((input.type ?? '').toLowerCase() === 'trade') return 'trade';
  return 'unsupported';
}

export type TransactionNormalization =
  | { ok: true; transaction: NormalizedTransaction }
  | { ok: false; reason: string };

const DIGITS = /^\d+$/;

export function canonicalProviderTransactionId(value: unknown): { ok: true; id: string } | { ok: false; reason: string } {
  if (value == null || value === '') {
    return { ok: false, reason: 'provider transaction id is missing' };
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { ok: false, reason: 'provider transaction id is not a positive integer' };
    }
    if (!Number.isSafeInteger(value)) {
      return { ok: false, reason: 'provider transaction id is outside the safe integer range' };
    }
    if (value <= 0) {
      return { ok: false, reason: 'provider transaction id is not a positive integer' };
    }
    return { ok: true, id: String(value) };
  }
  if (typeof value !== 'string') {
    return { ok: false, reason: 'provider transaction id is not a positive integer' };
  }
  const trimmed = value.trim();
  if (!DIGITS.test(trimmed)) {
    return { ok: false, reason: 'provider transaction id is not a positive integer' };
  }
  const canonical = trimmed.replace(/^0+(?=\d)/, '');
  if (canonical === '0') {
    return { ok: false, reason: 'provider transaction id is not a positive integer' };
  }
  return { ok: true, id: canonical };
}

export function protectedProviderRecord(record: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...record };
  delete copy['account-number'];
  return copy;
}

export function normalizeTransaction(raw: unknown): TransactionNormalization {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'transaction payload was empty' };
  }
  const record = raw as Record<string, unknown>;
  const providerId = canonicalProviderTransactionId(record.id ?? record['transaction-id']);
  if (!providerId.ok) {
    return providerId;
  }
  const providerTransactionId = providerId.id;
  const transactionType = text(record['transaction-type']);
  const transactionSubtype = text(record['transaction-sub-type']);
  const action = text(record.action);
  const fees = {
    'clearing-fees': asDecimalString(record['clearing-fees']),
    'regulatory-fees': asDecimalString(record['regulatory-fees']),
    'proprietary-index-option-fees': asDecimalString(record['proprietary-index-option-fees']),
    'other-fees': asDecimalString(record['other-fees']),
  };
  return {
    ok: true,
    transaction: {
      providerTransactionId,
      symbol: text(record.symbol),
      instrumentType: text(record['instrument-type']),
      action,
      quantity: asDecimalString(record.quantity),
      price: asDecimalString(record.price),
      executedAt: text(record['executed-at']) ?? text(record['transaction-date']),
      grossValue: asDecimalString(record.value) ?? asDecimalString(record['net-value']),
      valueEffect: text(record['value-effect']),
      commission: asDecimalString(record.commission),
      feesJson: JSON.stringify(fees),
      transactionType,
      transactionSubtype,
      classification: classifyTransaction({ type: transactionType, subtype: transactionSubtype, action }),
      raw: protectedProviderRecord(record),
    },
  };
}

export function maskAccountNumber(accountNumber: string): string {
  const tail = accountNumber.slice(-4);
  return `••••${tail}`;
}
