import { z } from 'zod';

/**
 * Authoritative implementation spec for the owner's PMCC preferences.
 * The Sal Talks Life PDFs are not in this repository and were not imported.
 * A later optional reference can point at those files without changing this schema.
 *
 * Version 2 adds revision metadata and optional advanced preferred targets.
 * Hard rules remain the investment floor; preferences are preferred targets;
 * exploratory / display filters live outside this saved profile.
 */

export const STRATEGY_PROFILE_VERSION = 2 as const;

const decimalText = z.string().regex(/^\d+(\.\d{1,4})?$/);
const moneyText = z.string().regex(/^\d+\.\d{2}$/);
const percentText = z.string().regex(/^\d+(\.\d{1,2})?$/);

export const strategyHardRequirementsSchema = z
  .object({
    maxContractCost: moneyText,
    minContractCost: moneyText.nullable().default(null),
    minLongDelta: decimalText,
    minExpirationDays: z.number().int().nonnegative(),
    maxExpirationDays: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const strategyPreferredTargetsSchema = z
  .object({
    idealContractCost: moneyText,
    preferredLongDelta: decimalText,
    minIntrinsicPercent: percentText,
    preferredExpirationDays: z.number().int().positive(),
    longerExpirationDays: z.number().int().positive(),
    maxBidAskSpreadPercent: percentText.nullable(),
    minOpenInterest: z.number().int().nonnegative().nullable(),
    minVolume: z.number().int().nonnegative().nullable(),
    maxExtrinsicDollars: moneyText.nullable().default(null),
    maxExtrinsicPercent: percentText.nullable().default(null),
    maxTheta: decimalText.nullable().default(null),
    maxThetaRelativeToCapital: decimalText.nullable().default(null),
    maxImpliedVolatility: decimalText.nullable().default(null),
    maxVega: decimalText.nullable().default(null),
    maxStrikeDistancePercent: percentText.nullable().default(null),
    downsidePercents: z.array(percentText).min(1),
    shortDte: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict(),
    shortDelta: z.object({ min: decimalText, max: decimalText }).strict(),
    shortManagementDelta: z.object({ min: decimalText, max: decimalText }).strict(),
    shortPremiumCapturePercent: z.object({ min: decimalText, max: decimalText }).strict(),
    leapsReassessmentPercent: z.array(percentText).min(1),
  })
  .strict();

export const strategyProfileSchema = z
  .object({
    version: z.literal(STRATEGY_PROFILE_VERSION),
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    revision: z.number().int().positive(),
    kind: z.enum(['builtin-template', 'custom']),
    originTemplateId: z.string().nullable(),
    isDefault: z.boolean(),
    authority: z.literal('implementation-spec'),
    referenceNote: z.string().min(1),
    references: z.array(
      z
        .object({
          title: z.string().min(1),
          path: z.string().min(1),
        })
        .strict(),
    ),
    hard: strategyHardRequirementsSchema,
    preferences: strategyPreferredTargetsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.hard.maxExpirationDays != null && value.hard.maxExpirationDays < value.hard.minExpirationDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Maximum expiration days must be at least the minimum.',
        path: ['hard', 'maxExpirationDays'],
      });
    }
    const minCost = value.hard.minContractCost == null ? null : Number(value.hard.minContractCost);
    const maxCost = Number(value.hard.maxContractCost);
    if (minCost != null && Number.isFinite(minCost) && minCost > maxCost) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum contract cost cannot exceed the hard maximum.',
        path: ['hard', 'minContractCost'],
      });
    }
    const minDelta = Number(value.hard.minLongDelta);
    const preferredDelta = Number(value.preferences.preferredLongDelta);
    if (Number.isFinite(minDelta) && Number.isFinite(preferredDelta) && preferredDelta < minDelta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Preferred delta should be at least the hard minimum delta.',
        path: ['preferences', 'preferredLongDelta'],
      });
    }
  });

export type StrategyProfile = z.infer<typeof strategyProfileSchema>;

/** Field metadata for Strategy Builder UI (beginner-friendly). */
export const STRATEGY_FIELD_HELP = {
  hard: {
    maxContractCost: {
      label: 'Maximum you will pay for one contract',
      unit: 'USD',
      help: 'Hard stop. Contracts costing more than this fail the hard rules.',
      range: '$100 – $50,000',
    },
    minContractCost: {
      label: 'Minimum contract cost (optional)',
      unit: 'USD',
      help: 'Optional floor. Leave blank to allow any cheaper contract.',
      range: 'Blank or $0 – maximum',
    },
    minLongDelta: {
      label: 'Minimum delta (stock-like movement)',
      unit: '0–1',
      help: 'Hard floor for how closely the option should move with the stock. Typical deep ITM: 0.75+.',
      range: '0.01 – 1.00',
    },
    minExpirationDays: {
      label: 'Minimum days until expiration',
      unit: 'days',
      help: 'Hard floor for length. 0 allows any expiration. 365 ≈ one year.',
      range: '0 – 2000',
    },
    maxExpirationDays: {
      label: 'Maximum days until expiration (optional)',
      unit: 'days',
      help: 'Optional ceiling. Leave blank for no upper limit.',
      range: 'Blank or ≥ minimum',
    },
  },
  preferences: {
    idealContractCost: {
      label: 'Ideal purchase cost',
      unit: 'USD',
      help: 'Preferred target used for ranking — not a hard reject.',
      range: 'Below maximum',
    },
    preferredLongDelta: {
      label: 'Preferred delta',
      unit: '0–1',
      help: 'Preferred target above the hard minimum. Missing this alone does not hide a contract.',
      range: '≥ hard minimum',
    },
    minIntrinsicPercent: {
      label: 'Preferred intrinsic value %',
      unit: '%',
      help: 'How much of the option price is already “in the money.” Preference only.',
      range: '0 – 100',
    },
    maxBidAskSpreadPercent: {
      label: 'Maximum bid/ask spread %',
      unit: '%',
      help: 'Leave blank = unassessed (not treated as passed).',
      range: 'Blank or 0 – 50',
    },
    minOpenInterest: {
      label: 'Minimum open interest',
      unit: 'contracts',
      help: 'Not available yet for most Finder quotes — shown as Unassessed when blank or missing.',
      range: 'Blank or ≥ 0',
    },
    minVolume: {
      label: 'Minimum trading volume',
      unit: 'contracts',
      help: 'Not available yet for most Finder quotes — shown as Unassessed when blank or missing.',
      range: 'Blank or ≥ 0',
    },
  },
} as const;

export const SAL_PMCC_DEEP_ITM: StrategyProfile = {
  version: 2,
  id: 'sal-pmcc-deep-itm',
  name: 'Sal PMCC — Deep ITM',
  revision: 1,
  kind: 'builtin-template',
  originTemplateId: null,
  isDefault: true,
  authority: 'implementation-spec',
  referenceNote:
    'Example strategy, revision 1. It shows how rules are stored. It is not a recommended investment strategy and it is not a later private revision of a personal profile. Reset restores this built-in template without deleting custom copies.',
  references: [],
  hard: {
    maxContractCost: '7000.00',
    minContractCost: null,
    minLongDelta: '0.75',
    minExpirationDays: 365,
    maxExpirationDays: null,
  },
  preferences: {
    idealContractCost: '6000.00',
    preferredLongDelta: '0.80',
    minIntrinsicPercent: '80',
    preferredExpirationDays: 365,
    longerExpirationDays: 730,
    maxBidAskSpreadPercent: null,
    minOpenInterest: null,
    minVolume: null,
    maxExtrinsicDollars: null,
    maxExtrinsicPercent: null,
    maxTheta: null,
    maxThetaRelativeToCapital: null,
    maxImpliedVolatility: null,
    maxVega: null,
    maxStrikeDistancePercent: null,
    downsidePercents: ['15', '20', '30'],
    shortDte: { min: 7, max: 21 },
    shortDelta: { min: '0.10', max: '0.18' },
    shortManagementDelta: { min: '0.30', max: '0.35' },
    shortPremiumCapturePercent: { min: '50', max: '70' },
    leapsReassessmentPercent: ['20', '25', '30', '40'],
  },
};

/** Upgrade stored JSON (v1 or partial) into a validated v2 profile. */
export function normalizeStrategyProfile(input: unknown): StrategyProfile {
  if (!input || typeof input !== 'object') {
    return structuredClone(SAL_PMCC_DEEP_ITM);
  }
  const raw = input as Record<string, unknown>;
  const hard = (raw.hard && typeof raw.hard === 'object' ? raw.hard : {}) as Record<string, unknown>;
  const preferences = (raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}) as Record<string, unknown>;
  const merged = {
    ...SAL_PMCC_DEEP_ITM,
    ...raw,
    version: 2,
    revision: typeof raw.revision === 'number' && raw.revision > 0 ? raw.revision : 1,
    kind: raw.kind === 'custom' ? 'custom' : raw.id && raw.id !== SAL_PMCC_DEEP_ITM.id ? 'custom' : 'builtin-template',
    originTemplateId:
      raw.originTemplateId === null || typeof raw.originTemplateId === 'string'
        ? (raw.originTemplateId as string | null)
        : raw.kind === 'custom'
          ? SAL_PMCC_DEEP_ITM.id
          : null,
    isDefault: typeof raw.isDefault === 'boolean' ? raw.isDefault : raw.id === SAL_PMCC_DEEP_ITM.id,
    hard: {
      ...SAL_PMCC_DEEP_ITM.hard,
      ...hard,
      minContractCost: hard.minContractCost === undefined ? null : hard.minContractCost,
      maxExpirationDays: hard.maxExpirationDays === undefined ? null : hard.maxExpirationDays,
    },
    preferences: {
      ...SAL_PMCC_DEEP_ITM.preferences,
      ...preferences,
      maxExtrinsicDollars: preferences.maxExtrinsicDollars === undefined ? null : preferences.maxExtrinsicDollars,
      maxExtrinsicPercent: preferences.maxExtrinsicPercent === undefined ? null : preferences.maxExtrinsicPercent,
      maxTheta: preferences.maxTheta === undefined ? null : preferences.maxTheta,
      maxThetaRelativeToCapital:
        preferences.maxThetaRelativeToCapital === undefined ? null : preferences.maxThetaRelativeToCapital,
      maxImpliedVolatility: preferences.maxImpliedVolatility === undefined ? null : preferences.maxImpliedVolatility,
      maxVega: preferences.maxVega === undefined ? null : preferences.maxVega,
      maxStrikeDistancePercent:
        preferences.maxStrikeDistancePercent === undefined ? null : preferences.maxStrikeDistancePercent,
    },
  };
  return strategyProfileSchema.parse(merged);
}

export interface LongCallObservation {
  contractCost: string | null;
  longDelta: string | null;
  intrinsicPercent: string | null;
  expirationDays: number | null;
  bidAskSpreadPercent: string | null;
  openInterest: number | null;
  volume: number | null;
}

export interface ShortCallObservation {
  delta: string | null;
  daysToExpiration: number | null;
  premiumCapturedPercent: string | null;
}

export interface StrategyClassification {
  outcome: 'exact' | 'near' | 'excluded' | 'incomplete';
  hardFailures: string[];
  preferenceGaps: string[];
  missingInputs: string[];
  unconfigured: string[];
  reviews: string[];
}

function cents(value: string): number | null {
  if (!/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split('.');
  return Number(whole) * 100 + Number(fraction);
}

function decimal(value: string): number | null {
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classify(input: {
  hardFailures: string[];
  preferenceGaps: string[];
  missingInputs: string[];
  unconfigured: string[];
  reviews: string[];
}): StrategyClassification {
  const outcome =
    input.missingInputs.length > 0
      ? 'incomplete'
      : input.hardFailures.length > 0
        ? 'excluded'
        : input.preferenceGaps.length > 0 || input.unconfigured.length > 0
          ? 'near'
          : 'exact';
  return { outcome, ...input };
}

export function classifyLongCall(profile: StrategyProfile, observation: LongCallObservation): StrategyClassification {
  const hardFailures: string[] = [];
  const preferenceGaps: string[] = [];
  const missingInputs: string[] = [];
  const unconfigured: string[] = [];
  const cost = observation.contractCost == null ? null : cents(observation.contractCost);
  const delta = observation.longDelta == null ? null : decimal(observation.longDelta);
  const intrinsic = observation.intrinsicPercent == null ? null : decimal(observation.intrinsicPercent);
  const minDelta = decimal(profile.hard.minLongDelta);
  const preferredDelta = decimal(profile.preferences.preferredLongDelta);
  const minIntrinsic = decimal(profile.preferences.minIntrinsicPercent);
  const maxCost = cents(profile.hard.maxContractCost);
  const minCost = profile.hard.minContractCost == null ? null : cents(profile.hard.minContractCost);
  const idealCost = cents(profile.preferences.idealContractCost);
  // Cost / DTE hard rules assess even when delta is missing (delta → cannot-verify incomplete, not hard fail).
  if (cost == null) missingInputs.push('Contract cost is missing.');
  else if (maxCost != null) {
    if (cost > maxCost) hardFailures.push(`Contract cost is above the ${profile.hard.maxContractCost} hard maximum.`);
    if (minCost != null && cost < minCost) hardFailures.push(`Contract cost is below the ${profile.hard.minContractCost} hard minimum.`);
  }
  if (observation.expirationDays == null) missingInputs.push('Expiration is missing.');
  else {
    if (observation.expirationDays < profile.hard.minExpirationDays) {
      hardFailures.push(`Expiration is below ${profile.hard.minExpirationDays} days.`);
    }
    if (profile.hard.maxExpirationDays != null && observation.expirationDays > profile.hard.maxExpirationDays) {
      hardFailures.push(`Expiration is above ${profile.hard.maxExpirationDays} days.`);
    }
  }
  if (delta == null) {
    missingInputs.push('Long delta is missing.');
  } else if (minDelta != null) {
    if (delta < minDelta) hardFailures.push(`Long delta is below the ${profile.hard.minLongDelta} minimum.`);
  }
  if (hardFailures.length === 0 && cost != null && delta != null && idealCost != null && preferredDelta != null) {
    if (cost >= idealCost) preferenceGaps.push(`Contract cost is not below the ${profile.preferences.idealContractCost} ideal.`);
    if (delta < preferredDelta) preferenceGaps.push(`Long delta is below the ${profile.preferences.preferredLongDelta} preference.`);
  }
  if (intrinsic == null || minIntrinsic == null) missingInputs.push('Intrinsic percentage is missing.');
  else if (hardFailures.length === 0 && intrinsic < minIntrinsic) preferenceGaps.push(`Intrinsic value is below ${profile.preferences.minIntrinsicPercent} percent.`);
  if (profile.preferences.maxBidAskSpreadPercent == null) unconfigured.push('Bid/ask spread limit is not configured.');
  else if (observation.bidAskSpreadPercent == null) missingInputs.push('Bid/ask spread is missing.');
  else {
    const spread = decimal(observation.bidAskSpreadPercent);
    const limit = decimal(profile.preferences.maxBidAskSpreadPercent);
    if (spread == null || limit == null) missingInputs.push('Bid/ask spread is missing.');
    else if (spread > limit) preferenceGaps.push('Bid/ask spread is wider than the configured limit.');
  }
  if (profile.preferences.minOpenInterest == null) unconfigured.push('Open-interest minimum is not configured.');
  else if (observation.openInterest == null) missingInputs.push('Open interest is missing.');
  else if (observation.openInterest < profile.preferences.minOpenInterest) preferenceGaps.push('Open interest is below the configured minimum.');
  if (profile.preferences.minVolume == null) unconfigured.push('Volume minimum is not configured.');
  else if (observation.volume == null) missingInputs.push('Volume is missing.');
  else if (observation.volume < profile.preferences.minVolume) preferenceGaps.push('Volume is below the configured minimum.');
  return classify({ hardFailures, preferenceGaps, missingInputs, unconfigured, reviews: [] });
}

export function classifyShortCall(profile: StrategyProfile, observation: ShortCallObservation): StrategyClassification {
  const preferenceGaps: string[] = [];
  const missingInputs: string[] = [];
  const reviews: string[] = [];
  const delta = observation.delta == null ? null : decimal(observation.delta);
  const captured = observation.premiumCapturedPercent == null ? null : decimal(observation.premiumCapturedPercent);
  if (delta == null) missingInputs.push('Short delta is missing.');
  if (observation.daysToExpiration == null) missingInputs.push('Short expiration is missing.');
  if (delta != null && observation.daysToExpiration != null) {
    const band = profile.preferences.shortDelta;
    const low = decimal(band.min);
    const high = decimal(band.max);
    if (low == null || high == null || delta < low || delta > high) preferenceGaps.push('Short delta is outside 0.10–0.18.');
    if (observation.daysToExpiration < profile.preferences.shortDte.min || observation.daysToExpiration > profile.preferences.shortDte.max) {
      preferenceGaps.push('Short expiration is outside 7–21 days.');
    }
    const review = profile.preferences.shortManagementDelta;
    const reviewLow = decimal(review.min);
    const reviewHigh = decimal(review.max);
    if (reviewLow != null && reviewHigh != null && delta >= reviewLow && delta <= reviewHigh) {
      reviews.push('Short delta is in the 0.30–0.35 management review band.');
    }
  }
  if (captured == null) missingInputs.push('Premium captured is missing.');
  else {
    const low = decimal(profile.preferences.shortPremiumCapturePercent.min);
    const high = decimal(profile.preferences.shortPremiumCapturePercent.max);
    if (low != null && high != null && captured >= low && captured <= high) {
      reviews.push('Premium captured is in the 50–70 percent review band.');
    }
  }
  return classify({ hardFailures: [], preferenceGaps, missingInputs, unconfigured: [], reviews });
}

export function downsidePrices(underlyingPrice: string, percents: readonly string[]): Array<{ percent: string; price: string }> | null {
  const price = cents(underlyingPrice);
  if (price == null) return null;
  return percents.map((percent) => {
    const portion = decimal(percent);
    if (portion == null) return { percent, price: 'unavailable' };
    const next = Math.round(price * (100 - portion)) / 100;
    return { percent, price: (next / 100).toFixed(2) };
  });
}
