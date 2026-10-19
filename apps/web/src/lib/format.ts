import type { TransactionView } from '@optionscout/shared';

export function formatMoney(value: string | null | undefined): string {
  if (value == null) return 'Unavailable';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'Unavailable';
  return formatUsd(parsed);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatSignedUsd(value: number): string {
  const formatted = formatUsd(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

export function formatSnapshot(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(isoTimestamp));
}

const ACTION_LABELS: Record<TransactionView['action'], string> = {
  buy_to_open: 'Buy to open',
  sell_to_open: 'Sell to open',
  buy_to_close: 'Buy to close',
  sell_to_close: 'Sell to close',
  expire: 'Expired',
};

export function formatAction(action: TransactionView['action']): string {
  return ACTION_LABELS[action];
}

export function pnlColor(value: number): string {
  if (value > 0) return 'success.main';
  if (value < 0) return 'error.main';
  return 'text.secondary';
}
