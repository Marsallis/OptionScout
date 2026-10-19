/**
 * Owner-downloaded ETF holdings CSV preview (no network fetch).
 * Does not claim optionability.
 */

import { z } from 'zod';
import { validateTickerSymbol } from './smart-scan.js';

export const HOLDINGS_IMPORT_MAX_ROWS = 4000;
export const HOLDINGS_IMPORT_MAX_BYTES = 2_500_000;

const holdingsMappingSchema = z
  .object({
    ticker: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    sector: z.string().min(1).max(200).optional(),
    weight: z.string().min(1).max(200).optional(),
    assetClass: z.string().min(1).max(200).optional(),
  })
  .strict();

export const holdingsPreviewRequestSchema = z
  .object({
    csvText: z
      .string()
      .min(1, 'Choose a holdings CSV file.')
      .max(HOLDINGS_IMPORT_MAX_BYTES, `Holdings file exceeds ${HOLDINGS_IMPORT_MAX_BYTES.toLocaleString('en-US')} characters.`),
    mapping: holdingsMappingSchema.optional(),
    /** How to read a weight column that does not mark its own scale. */
    weightChoice: z.enum(['auto', 'percentage-points', 'decimal-fraction']).default('auto'),
  })
  .strict();

export const holdingsCommitRequestSchema = holdingsPreviewRequestSchema
  .extend({
    name: z.string().trim().min(1, 'A collection name is required.').max(120),
    /** Present to add a new version to an existing saved collection. */
    universeId: z.string().min(1).max(80).nullable().optional(),
    fundTicker: z.string().trim().max(12).nullable().optional(),
    provider: z.string().trim().min(1).max(80).default('Owner CSV'),
    holdingsEffectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the holdings date shown on the provider file (YYYY-MM-DD).'),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/, 'Preview and validate the file before saving.'),
  })
  .strict();

export type HoldingsCommitRequest = z.infer<typeof holdingsCommitRequestSchema>;
/** JSON request limit for the holdings routes only (CSV text plus escaping overhead). */
export const HOLDINGS_IMPORT_MAX_REQUEST_BYTES = 3_500_000;
/** Rows returned to the browser; counts always cover the whole file. */
export const HOLDINGS_PREVIEW_ROW_LIMIT = 4000;

export type HoldingsColumnRole = 'ticker' | 'name' | 'sector' | 'weight' | 'assetClass' | 'ignore';
export type HoldingsMappableRole = Exclude<HoldingsColumnRole, 'ignore'>;

export type HoldingsRowStatus = 'equity' | 'duplicate' | 'invalid' | 'non-equity' | 'cash' | 'ignored';

export type HoldingsPreviewRow = {
  line: number;
  rawTicker: string;
  ticker: string | null;
  name: string | null;
  sector: string | null;
  weight: string | null;
  /** Percent of the fund, such as 7.1 for 7.1%. Null when the scale is unknown. */
  weightPercent: string | null;
  assetClass: string | null;
  status: HoldingsRowStatus;
  reason: string;
};

export type HoldingsPreview = {
  headers: string[];
  headerLine: number;
  mapping: Record<string, HoldingsColumnRole>;
  rows: HoldingsPreviewRow[];
  rowsTruncated: boolean;
  uniqueEquityTickers: string[];
  companyNames: Record<string, string>;
  sectors: Record<string, string>;
  weights: Record<string, string>;
  /** Same companies as `weights`, in percent-of-fund points. Empty when the scale is unknown. */
  weightPercents: Record<string, string>;
  weightReading: 'percent-sign' | 'percentage-points' | 'decimal-fraction' | 'ambiguous' | 'missing';
  weightReadingReason: string;
  counts: {
    parsed: number;
    equity: number;
    duplicate: number;
    invalid: number;
    nonEquity: number;
    cash: number;
    ignored: number;
    normalizedShareClass: number;
  };
  /** Holdings date found in provider preamble text, if any. The owner confirms it before saving. */
  detectedEffectiveDate: string | null;
  /** SHA-256 hex of the exact CSV text; commit must present the hash that was previewed. */
  contentHash: string;
  truncated: boolean;
};

const TICKER_HINTS = ['ticker', 'symbol', 'holding ticker', 'constituent ticker'];
const NAME_HINTS = ['name', 'holding', 'security name', 'issuer', 'company'];
const SECTOR_HINTS = ['sector', 'gics sector'];
const WEIGHT_HINTS = ['weight', '% of net assets', 'portfolio weight'];
const CLASS_HINTS = ['asset class', 'assetclass', 'security type', 'type'];

function roleForHeader(header: string): HoldingsColumnRole {
  const h = header.trim().toLowerCase();
  if (TICKER_HINTS.some((hint) => h === hint || h.includes(hint))) return 'ticker';
  if (SECTOR_HINTS.some((hint) => h.includes(hint))) return 'sector';
  if (WEIGHT_HINTS.some((hint) => h.includes(hint))) return 'weight';
  if (CLASS_HINTS.some((hint) => h === hint || h.includes(hint))) return 'assetClass';
  if (NAME_HINTS.some((hint) => h === hint || h.includes(hint))) return 'name';
  return 'ignore';
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function findHeaderIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
    const cells = splitCsvLine(lines[i]!).map((c) => c.toLowerCase());
    if (cells.length >= 2 && cells.some((c) => TICKER_HINTS.some((hint) => c === hint || c.includes(hint)))) return i;
  }
  return 0;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseDateText(text: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  const named = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (named && MONTHS[named[1]!.toLowerCase()]) {
    return `${named[3]}-${MONTHS[named[1]!.toLowerCase()]}-${named[2]!.padStart(2, '0')}`;
  }
  const dmy = /(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})/.exec(text);
  if (dmy && MONTHS[dmy[2]!.toLowerCase()]) {
    return `${dmy[3]}-${MONTHS[dmy[2]!.toLowerCase()]}-${dmy[1]!.padStart(2, '0')}`;
  }
  return null;
}

function detectEffectiveDate(preamble: string[]): string | null {
  for (const line of preamble) {
    if (/as of|holdings date|effective/i.test(line)) {
      const found = parseDateText(line);
      if (found) return found;
    }
  }
  return null;
}

/** Classify by the provider's asset-class column when present; otherwise only obvious cash rows. */
function classifyInstrument(ticker: string, assetClass: string | null, name: string | null): 'cash' | 'non-equity' | null {
  if (assetClass) {
    const cls = assetClass.toLowerCase();
    if (/cash|money market|currency|collateral|margin/.test(cls)) return 'cash';
    if (/equity|common|stock|share/.test(cls) && !/preferred|fund|etf/.test(cls)) return null;
    return 'non-equity';
  }
  if (/^(USD|CASH|CASH_USD)$/.test(ticker) || /\b(cash|money market)\b/i.test(name ?? '')) return 'cash';
  return null;
}

export class HoldingsPreviewError extends Error {}

export type HoldingsWeightChoice = 'auto' | 'percentage-points' | 'decimal-fraction';
export type HoldingsWeightReading = 'percent-sign' | 'percentage-points' | 'decimal-fraction' | 'ambiguous' | 'missing';

function parseWeightToken(raw: string | null | undefined): { signed: boolean; value: number } | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const signed = text.includes('%');
  const value = Number(text.replace(/%/g, '').replace(/,/g, ''));
  return Number.isFinite(value) ? { signed, value } : null;
}

function formatPercentPoints(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, '');
}

function headerSaysPercent(header: string | null): boolean {
  return Boolean(header && /%|percent/i.test(header));
}

/**
 * Read a holdings weight column without guessing when the scale is unclear.
 * A percent sign, or a header that says percent, means percentage points (7.1 or 7.1% → 7.1%).
 * A column that is not labeled as percent is a fraction only when the numbers add up to about 1,
 * and percentage points only when they add up to about 100. Otherwise the weights stay uninterpreted.
 */
export function interpretHoldingsWeights(input: {
  header: string | null;
  rawValues: Array<string | null>;
  choice?: HoldingsWeightChoice;
}): { reading: HoldingsWeightReading; reason: string; percents: Array<string | null> } {
  const choice = input.choice ?? 'auto';
  const parsed = input.rawValues.map((raw) => parseWeightToken(raw));
  const numbers = parsed.flatMap((row) => (row ? [row.value] : []));
  if (numbers.length === 0) {
    return {
      reading: 'missing',
      reason: 'No numeric weights were found, so nothing is ordered by fund weight.',
      percents: parsed.map(() => null),
    };
  }
  const sum = numbers.reduce((total, value) => total + value, 0);
  const labeledPercent = headerSaysPercent(input.header);
  const anySigned = parsed.some((row) => row?.signed);
  const allSigned = parsed.every((row) => row == null || row.signed);

  const asPoints = (row: { signed: boolean; value: number } | null): string | null =>
    row ? formatPercentPoints(row.value) : null;
  const asFraction = (row: { signed: boolean; value: number } | null): string | null => {
    if (!row) return null;
    return formatPercentPoints(row.signed ? row.value : row.value * 100);
  };

  if (choice === 'percentage-points' || (choice === 'auto' && (labeledPercent || allSigned))) {
    return {
      reading: allSigned && !labeledPercent ? 'percent-sign' : 'percentage-points',
      reason: choice === 'percentage-points'
        ? 'You chose percentage points, so 7.1 means 7.1% of the fund.'
        : allSigned
          ? 'Values include a percent sign, so 7.1% means 7.1% of the fund.'
          : `The column “${input.header}” says percent, so 7.1 means 7.1% of the fund. It is not multiplied by 100.`,
      percents: parsed.map(asPoints),
    };
  }
  if (choice === 'decimal-fraction') {
    return {
      reading: 'decimal-fraction',
      reason: 'You chose fractions of the fund, so 0.071 means 7.1%. A value that already has a percent sign is left as that percent.',
      percents: parsed.map(asFraction),
    };
  }
  if (numbers.every((value) => value >= 0 && value <= 1) && sum >= 0.9 && sum <= 1.1) {
    return {
      reading: 'decimal-fraction',
      reason: 'The column does not say percent, and the numbers add up to about 1, so 0.071 is read as 7.1% of the fund.',
      percents: parsed.map(asFraction),
    };
  }
  if (numbers.some((value) => value > 1) && sum >= 90 && sum <= 110 && !anySigned) {
    return {
      reading: 'percentage-points',
      reason: 'The column does not say percent, and the numbers add up to about 100, so 7.1 is read as 7.1% of the fund.',
      percents: parsed.map(asPoints),
    };
  }
  return {
    reading: 'ambiguous',
    reason:
      'These weights are not marked as percents and do not add up to about 1 or about 100. They are shown as written and are not used to order companies until you choose percentage points or fractions.',
    percents: parsed.map(() => null),
  };
}

export function previewHoldingsCsv(
  text: string,
  overrides: Partial<Record<HoldingsMappableRole, string>> = {},
  sha256Hex?: (value: string) => string,
  weightChoice: HoldingsWeightChoice = 'auto',
): HoldingsPreview {
  if (text.length > HOLDINGS_IMPORT_MAX_BYTES) {
    throw new HoldingsPreviewError(`Holdings file exceeds ${HOLDINGS_IMPORT_MAX_BYTES.toLocaleString('en-US')} characters.`);
  }
  const allLines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const lines = allLines.map((line, index) => ({ line, number: index + 1 })).filter((row) => row.line.trim().length > 0);
  if (lines.length === 0) throw new HoldingsPreviewError('The holdings file is empty.');
  const headerIndex = findHeaderIndex(lines.map((row) => row.line));
  const headers = splitCsvLine(lines[headerIndex]!.line);
  const mapping: Record<string, HoldingsColumnRole> = {};
  for (const header of headers) mapping[header] = roleForHeader(header);
  for (const [role, header] of Object.entries(overrides) as Array<[HoldingsMappableRole, string | undefined]>) {
    if (!header) continue;
    if (!headers.includes(header)) {
      throw new HoldingsPreviewError(`Mapped column “${header}” was not found in the header row.`);
    }
    for (const [key, value] of Object.entries(mapping)) {
      if (value === role) mapping[key] = 'ignore';
    }
    mapping[header] = role;
  }
  const indexOf = (role: HoldingsColumnRole) => headers.findIndex((header) => mapping[header] === role);
  const tickerIdx = indexOf('ticker');
  if (tickerIdx < 0) {
    throw new HoldingsPreviewError('Could not find a ticker/symbol column. Choose the ticker column manually.');
  }
  const nameIdx = indexOf('name');
  const sectorIdx = indexOf('sector');
  const weightIdx = indexOf('weight');
  const classIdx = indexOf('assetClass');

  const rows: HoldingsPreviewRow[] = [];
  const seen = new Set<string>();
  const uniqueEquityTickers: string[] = [];
  const companyNames: Record<string, string> = {};
  const sectors: Record<string, string> = {};
  const weights: Record<string, string> = {};
  const counts = { parsed: 0, equity: 0, duplicate: 0, invalid: 0, nonEquity: 0, cash: 0, ignored: 0, normalizedShareClass: 0 };
  let truncated = false;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (counts.parsed >= HOLDINGS_IMPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    const { line, number } = lines[i]!;
    const cells = splitCsvLine(line);
    if (cells.every((c) => !c)) continue;
    counts.parsed += 1;
    const rawTicker = cells[tickerIdx] ?? '';
    const name = nameIdx >= 0 ? cells[nameIdx] || null : null;
    const sector = sectorIdx >= 0 ? cells[sectorIdx] || null : null;
    const weight = weightIdx >= 0 ? cells[weightIdx] || null : null;
    const assetClass = classIdx >= 0 ? cells[classIdx] || null : null;
    const base = { line: number, rawTicker, name, sector, weight, weightPercent: null, assetClass };

    const filled = cells.filter((c) => c.length > 0).length;
    if (filled <= 1 && headers.length > 1) {
      counts.ignored += 1;
      rows.push({ ...base, ticker: null, status: 'ignored', reason: 'Provider note, header, or footer row — not a holding.' });
      continue;
    }
    if (!rawTicker.trim() || rawTicker.trim() === '-') {
      const kind = classifyInstrument('', assetClass, name);
      if (kind === 'cash') {
        counts.cash += 1;
        rows.push({ ...base, ticker: null, status: 'cash', reason: 'Cash or currency holding without a ticker — not a stock.' });
      } else {
        counts.invalid += 1;
        rows.push({ ...base, ticker: null, status: 'invalid', reason: 'Missing ticker.' });
      }
      continue;
    }
    const kind = classifyInstrument(rawTicker.trim().toUpperCase(), assetClass, name);
    if (kind === 'cash') {
      counts.cash += 1;
      rows.push({ ...base, ticker: null, status: 'cash', reason: 'Cash or currency holding — not queued as a stock to search.' });
      continue;
    }
    if (kind === 'non-equity') {
      counts.nonEquity += 1;
      rows.push({
        ...base,
        ticker: null,
        status: 'non-equity',
        reason: `Non-equity instrument (asset class “${assetClass}”) — not queued.`,
      });
      continue;
    }
    const checked = validateTickerSymbol(rawTicker);
    if (!checked.ok) {
      counts.invalid += 1;
      rows.push({ ...base, ticker: null, status: 'invalid', reason: `${checked.reason} — symbols are not rewritten.` });
      continue;
    }
    const ticker = checked.ticker;
    if (seen.has(ticker)) {
      counts.duplicate += 1;
      rows.push({ ...base, ticker, status: 'duplicate', reason: 'Duplicate symbol in this file — first occurrence kept.' });
      continue;
    }
    seen.add(ticker);
    uniqueEquityTickers.push(ticker);
    if (name) companyNames[ticker] = name;
    if (sector) sectors[ticker] = sector;
    if (weight) weights[ticker] = weight;
    counts.equity += 1;
    if (checked.normalizedFrom) counts.normalizedShareClass += 1;
    rows.push({
      ...base,
      ticker,
      status: 'equity',
      reason: checked.normalizedFrom
        ? `Share-class separator normalized from ${checked.normalizedFrom} to ${ticker}. Option support is checked only when a scan runs.`
        : 'Stock holding. Option support is checked only when a scan runs.',
    });
  }

  if (counts.equity === 0 && counts.parsed === 0) {
    throw new HoldingsPreviewError('No holdings rows were found below the header row.');
  }

  const weightHeader = weightIdx >= 0 ? headers[weightIdx]! : null;
  const interpreted = interpretHoldingsWeights({
    header: weightHeader,
    rawValues: rows.map((row) => row.weight),
    choice: weightChoice,
  });
  const finishedRows = rows.map((row, index) => ({ ...row, weightPercent: interpreted.percents[index] ?? null }));
  const weightPercents: Record<string, string> = {};
  for (const row of finishedRows) {
    if (row.status === 'equity' && row.ticker && row.weightPercent) weightPercents[row.ticker] = row.weightPercent;
  }
  const preamble = lines.slice(0, headerIndex).map((row) => row.line);
  return {
    headers,
    headerLine: lines[headerIndex]!.number,
    mapping,
    rows: finishedRows.slice(0, HOLDINGS_PREVIEW_ROW_LIMIT),
    rowsTruncated: finishedRows.length > HOLDINGS_PREVIEW_ROW_LIMIT,
    uniqueEquityTickers,
    companyNames,
    sectors,
    weights,
    weightPercents,
    weightReading: interpreted.reading,
    weightReadingReason: interpreted.reason,
    counts,
    detectedEffectiveDate: detectEffectiveDate(preamble),
    contentHash: sha256Hex ? sha256Hex(text) : '',
    truncated,
  };
}
