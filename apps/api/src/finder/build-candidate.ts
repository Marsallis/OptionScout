import {
  DISCOVERY_OUTCOME_LABELS,
  assessUnderlyingOptionPairing,
  bidAskSpreadDollars,
  bidAskSpreadPercent,
  daysToExpiration,
  deltaCapitalExposure,
  downsideMoneynessPercent,
  estimatedPurchaseCost,
  evaluateContract,
  expirationBreakEven,
  extrinsicValue,
  hasRejectValidationIssue,
  intrinsicPercent,
  intrinsicValue,
  isCrossedMarket,
  isImpossibleStandardCallIntrinsic,
  isInvalidPrice,
  isUnderlyingNbboWide,
  midpoint,
  strikeDistance,
  type DiscoveryContract,
  type DiscoveryTolerances,
  type FinderCandidate,
  type MarketDataQuality,
  type StrategyProfile,
  type ValidationIssue,
  SHOW_PROFILE_MISSES,
} from '@optionscout/shared';
import { tradingSessionKey } from '../brokerage/market-hours.js';
import type { NestedChainContract } from './chain.js';
import { assessScreeningFreshness } from './freshness.js';
import { assessGreekVerification, classifyObservationFreshness, GREEK_QUOTE_ALIGN_MS } from './observations.js';
import type { FinderQuoteSnapshot } from './quotes.js';

function moneyOrNull(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (/^-?\d+\.\d{2}$/.test(value)) return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
  }
  return null;
}

function decimalOrNull(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (/^-?\d+(\.\d{1,4})?$/.test(value)) return value;
  return null;
}

export function buildFinderCandidate(input: {
  contract: NestedChainContract;
  underlyingPrice: string | null;
  underlyingQuoteAt?: string | null;
  /** Optional equity NBBO for wide-spread warnings (not automatic option reject). */
  underlyingBid?: string | null;
  underlyingAsk?: string | null;
  /** Set when a continuation could not refresh the stock price; explains an unverifiable pairing. */
  underlyingRefreshNote?: string | null;
  quote: FinderQuoteSnapshot | null;
  profile: StrategyProfile;
  tolerances: DiscoveryTolerances;
  asOfDate: string;
  now: Date;
  screeningFreshnessSeconds: number;
}): FinderCandidate {
  const { contract } = input;
  const quote = input.quote;
  const bid = moneyOrNull(quote?.bid ?? null);
  const ask = moneyOrNull(quote?.ask ?? null);
  const mark = moneyOrNull(quote?.mark ?? null) ?? midpoint(bid, ask);
  const delta = decimalOrNull(quote?.delta ?? null);
  const theta = decimalOrNull(quote?.theta ?? null);
  const gamma = decimalOrNull(quote?.gamma ?? null);
  const vega = decimalOrNull(quote?.vega ?? null);
  const impliedVolatility = decimalOrNull(quote?.impliedVolatility ?? null);
  const underlyingPrice = moneyOrNull(input.underlyingPrice);
  const underlyingBid = moneyOrNull(input.underlyingBid ?? null);
  const underlyingAsk = moneyOrNull(input.underlyingAsk ?? null);

  const screening = assessScreeningFreshness({
    providerEventAt: quote?.providerEventAt ?? null,
    greekEventAt: quote?.greekEventAt ?? null,
    receivedAt: quote?.receivedAt ?? input.now.toISOString(),
    now: input.now,
    screeningFreshnessSeconds: input.screeningFreshnessSeconds,
  });

  const crossedMarket = isCrossedMarket(bid, ask);
  const missingBid = bid == null;
  const missingAsk = ask == null;
  const invalidPrice = isInvalidPrice(bid) || isInvalidPrice(ask);

  const observationFreshness =
    quote?.observationFreshness ?? classifyObservationFreshness(quote?.providerEventAt ?? null, input.now);
  const greekVerification = assessGreekVerification({
    quoteProviderEventAt: quote?.providerEventAt ?? null,
    greekProviderEventAt: quote?.greekEventAt ?? null,
    delta,
    now: input.now,
    alignMs: Math.max(GREEK_QUOTE_ALIGN_MS, input.screeningFreshnessSeconds * 1000),
  });
  const unverifiedGreeks = greekVerification === 'historical-unverified';
  /** Classification must not treat mismatched/historical Greeks as a current delta pass or fail. */
  const classificationDelta = greekVerification === 'aligned' ? delta : null;
  const missingGreeks = classificationDelta == null;

  const underlyingMs = input.underlyingQuoteAt ? Date.parse(input.underlyingQuoteAt) : Number.NaN;
  const optionMs = quote?.providerEventAt ? Date.parse(quote.providerEventAt) : Number.NaN;
  const quoteSkewSeconds =
    Number.isFinite(underlyingMs) && Number.isFinite(optionMs)
      ? Math.abs(optionMs - underlyingMs) / 1000
      : null;

  const intrinsic = intrinsicValue(underlyingPrice, contract.strike);
  const purchaseCost = estimatedPurchaseCost(ask, contract.multiplier);
  const extrinsicPerShare = extrinsicValue(ask, intrinsic);
  const intrinsicPct = intrinsicPercent(intrinsic, ask);
  const impossibleIntrinsic = isImpossibleStandardCallIntrinsic({
    optionType: contract.optionType,
    standardContract: contract.standardContract,
    supportStatus: contract.supportStatus,
    intrinsicPerShare: intrinsic,
    ask,
    intrinsicPercent: intrinsicPct,
  });

  const validationIssues: ValidationIssue[] = [];

  if (contract.supportStatus !== 'supported' || contract.optionType !== 'call') {
    validationIssues.push({
      code: 'unsupported_contract',
      severity: 'reject',
      message: contract.supportNote || 'Contract is unsupported for LEAPS screening.',
      details: { supportStatus: contract.supportStatus, optionType: contract.optionType },
    });
  }
  if (!quote || missingAsk) {
    validationIssues.push({
      code: 'missing_option_ask',
      severity: 'reject',
      message: 'Option ask is missing, so purchase cost and intrinsic share cannot be assessed.',
    });
  }
  if (crossedMarket) {
    validationIssues.push({
      code: 'crossed_option_market',
      severity: 'reject',
      message: 'Option bid is above the ask, so the quote is inconsistent.',
      details: { bid, ask },
    });
  }
  if (invalidPrice) {
    validationIssues.push({
      code: 'invalid_option_price',
      severity: 'reject',
      message: 'Option bid or ask is an invalid non-positive price.',
      details: { bid, ask },
    });
  }
  if (screening.quoteGreekMismatch) {
    validationIssues.push({
      code: 'quote_greek_mismatch',
      severity: 'warning',
      message: 'Option quote and Greek provider timestamps differ beyond the screening window.',
      details: {
        providerEventAt: quote?.providerEventAt ?? null,
        greekEventAt: quote?.greekEventAt ?? null,
        screeningFreshnessSeconds: input.screeningFreshnessSeconds,
      },
    });
  }
  if (greekVerification === 'historical-unverified') {
    validationIssues.push({
      code: 'greek_unaligned',
      severity: 'warning',
      message:
        'Greeks are available for research but are not time-aligned with the option quote, so delta hard/preferred rules cannot be verified.',
      details: {
        delta,
        providerEventAt: quote?.providerEventAt ?? null,
        greekEventAt: quote?.greekEventAt ?? null,
      },
    });
  } else if (greekVerification === 'unavailable' || delta == null) {
    validationIssues.push({
      code: 'missing_greeks',
      severity: 'warning',
      message: 'Delta is missing, so the strategy delta requirement cannot be verified.',
      details: { greekVerification },
    });
  }
  if (isUnderlyingNbboWide(underlyingBid, underlyingAsk)) {
    validationIssues.push({
      code: 'underlying_nbbo_wide',
      severity: 'warning',
      message:
        'Underlying equity bid/ask is unusually wide. Spot uses mark/tight mid/bid preference; this alone does not reject the option when mark-based intrinsic is possible.',
      details: { underlyingBid, underlyingAsk, underlyingPrice },
    });
  }

  validationIssues.push(
    ...assessUnderlyingOptionPairing({
      marketSession: screening.marketSession,
      observationFreshness,
      quoteSkewSeconds,
      screeningFreshnessSeconds: input.screeningFreshnessSeconds,
      impossibleIntrinsic,
      underlyingQuoteAt: input.underlyingQuoteAt ?? null,
      optionQuoteAt: quote?.providerEventAt ?? null,
      underlyingPrice,
      strike: contract.strike,
      ask,
      intrinsicPerShare: intrinsic,
      intrinsicPercent: intrinsicPct,
    }),
  );

  const underlyingSession = Number.isFinite(underlyingMs) ? tradingSessionKey(new Date(underlyingMs)) : null;
  const optionSession = Number.isFinite(optionMs) ? tradingSessionKey(new Date(optionMs)) : null;
  const sessionMismatch = underlyingSession != null && optionSession != null && underlyingSession !== optionSession;
  const unverifiablePairing = Boolean(input.underlyingRefreshNote) && optionSession != null && underlyingSession == null;
  if (underlyingPrice != null && (sessionMismatch || unverifiablePairing)) {
    validationIssues.push({
      code: 'stock_option_session_mismatch',
      severity: 'reject',
      message:
        (sessionMismatch
          ? `The stock price (observed ${input.underlyingQuoteAt}, ${underlyingSession} session) and the option quote (observed ${quote?.providerEventAt}, ${optionSession} session) come from different trading sessions.`
          : 'The stock price has no observation time, so it cannot be matched to the option quote.') +
        ' Intrinsic value, extrinsic value, and the intrinsic-share requirement are unverified.' +
        (input.underlyingRefreshNote ? ` ${input.underlyingRefreshNote}` : ''),
      details: {
        underlyingQuoteAt: input.underlyingQuoteAt ?? null,
        optionQuoteAt: quote?.providerEventAt ?? null,
        underlyingSession,
        optionSession,
        quoteSkewSeconds: quoteSkewSeconds == null ? null : Math.round(quoteSkewSeconds),
      },
    });
  }

  const hardReject = hasRejectValidationIssue(validationIssues);

  let dataQuality: MarketDataQuality = 'usable';
  if (validationIssues.some((issue) => issue.code === 'unsupported_contract' || issue.code === 'missing_option_ask')) {
    dataQuality = 'missing';
  } else if (validationIssues.some((issue) => issue.code === 'invalid_option_price')) {
    dataQuality = 'invalid';
  } else if (
    validationIssues.some(
      (issue) =>
        issue.severity === 'reject' &&
        (issue.code === 'crossed_option_market' ||
          issue.code === 'option_ask_below_intrinsic' ||
          issue.code === 'stock_option_live_skew' ||
          issue.code === 'stock_option_session_mismatch'),
    )
  ) {
    dataQuality = 'inconsistent';
  } else if (screening.missingProviderTimestamp || screening.staleInputs) {
    // After-hours / previous-session snapshots with a provider timestamp remain numerically usable.
    // Quote/Greek mismatch and research clock gaps are warnings — not automatic inconsistent.
    if (
      (screening.afterHoursSnapshot || observationFreshness === 'previous-session' || observationFreshness === 'older') &&
      !screening.missingProviderTimestamp
    ) {
      dataQuality = 'usable';
    } else if (screening.missingProviderTimestamp) {
      dataQuality = 'missing';
      if (!validationIssues.some((issue) => issue.code === 'missing_essential_fields')) {
        validationIssues.push({
          code: 'missing_essential_fields',
          severity: 'reject',
          message: 'Provider event timestamp is missing for the option quote.',
        });
      }
    } else {
      // Live regular-session age beyond window without a hard skew reject — stale but assessable for prices.
      dataQuality = 'stale';
    }
  }

  const spreadDollars = bidAskSpreadDollars(bid, ask);
  const spreadPct = bidAskSpreadPercent(bid, ask);
  const breakEven = expirationBreakEven(contract.strike, ask);
  const dte = contract.daysToExpiration ?? daysToExpiration(contract.expiration, input.asOfDate);
  const distance = strikeDistance(underlyingPrice, contract.strike);
  const down15 = downsideMoneynessPercent(underlyingPrice, contract.strike, '15');
  const down20 = downsideMoneynessPercent(underlyingPrice, contract.strike, '20');
  const down30 = downsideMoneynessPercent(underlyingPrice, contract.strike, '30');
  const exposure = deltaCapitalExposure(classificationDelta, underlyingPrice, ask);

  // Pass usable (or stale) quality into discovery when prices are assessable; reject codes already set inconsistent/invalid/missing.
  const discoveryDataQuality: MarketDataQuality =
    dataQuality === 'stale' ? 'usable' : dataQuality;

  const discoveryContract: DiscoveryContract = {
    id: contract.occSymbol,
    underlying: contract.underlying,
    symbol: contract.occSymbol,
    contractCost: purchaseCost,
    delta: classificationDelta,
    intrinsicPercent: intrinsicPct,
    // Let discovery derive extrinsic from cost and intrinsic percent to avoid per-share vs per-contract unit mismatch.
    extrinsicValue: null,
    bid,
    ask,
    bidAskSpreadPercent: spreadPct,
    openInterest: quote?.openInterest ?? null,
    volume: quote?.volume ?? null,
    expirationDays: dte,
    theta,
    underlyingPrice,
    strike: contract.strike,
    downsidePercent: '15',
    quantity: 1,
    multiplier: contract.multiplier,
    dataQuality: discoveryDataQuality,
    shortCandidate: null,
  };

  const row = evaluateContract(input.profile, input.tolerances ?? SHOW_PROFILE_MISSES, discoveryContract);

  const rejectReasonTexts = validationIssues
    .filter((issue) => issue.severity === 'reject')
    .map((issue) => ({
      metric: 'data' as const,
      kind: 'data' as const,
      passed: false,
      target: issue.code,
      actual: issue.details?.quoteSkewSeconds != null ? String(issue.details.quoteSkewSeconds) : null,
      difference: null,
      text: issue.message,
    }));

  const greekCannotVerifyReason =
    greekVerification !== 'aligned'
      ? {
          metric: 'delta' as const,
          kind: 'data' as const,
          passed: false,
          target: 'aligned with option quote',
          actual: delta,
          difference: null,
          text:
            delta == null
              ? 'Delta requirement not verified.'
              : `Delta ${delta} is available for research but is not time-aligned with the option quote, so the strategy delta requirement is not verified.`,
        }
      : null;

  const reasons = [...rejectReasonTexts, ...(greekCannotVerifyReason ? [greekCannotVerifyReason] : []), ...row.reasons].filter(
    Boolean,
  ) as typeof row.reasons;

  // Hard rejects (crossed / impossible intrinsic / live skew / invalid) force incomplete.
  // Unverified Greeks alone do NOT blanket-force incomplete — classificationDelta null already
  // yields incomplete via classifyLongCall when delta is required; cost/DTE may still assess.
  const outcome = hardReject && row.outcome !== 'incomplete' ? ('incomplete' as const) : row.outcome;

  const hardFailed = reasons.some((reason) => reason.kind === 'hard' && !reason.passed);
  const preferenceFailed = reasons.some((reason) => reason.kind === 'preference' && !reason.passed);
  const liquidityUnassessed = reasons.some((reason) => reason.kind === 'unconfigured' && !reason.passed);

  // Historical fit: previous-session with aligned Greeks and usable prices may meet numeric rules.
  // Unaligned/missing Greeks never set meetsConfiguredNumericRequirements.
  const meetsConfiguredNumericRequirements =
    outcome !== 'incomplete' &&
    !hardFailed &&
    !preferenceFailed &&
    !hardReject &&
    (dataQuality === 'usable' || dataQuality === 'stale') &&
    greekVerification === 'aligned' &&
    (observationFreshness === 'current-session' || observationFreshness === 'previous-session');

  return {
    id: contract.occSymbol,
    underlying: contract.underlying,
    occSymbol: contract.occSymbol,
    streamerSymbol: contract.streamerSymbol,
    optionType: contract.optionType,
    strike: contract.strike,
    expiration: contract.expiration,
    multiplier: contract.multiplier,
    chainType: contract.chainType,
    standardContract: contract.standardContract,
    supportStatus: contract.supportStatus,
    supportNote: contract.supportNote,
    active: contract.active,
    closingOnly: contract.closingOnly,
    underlyingPrice,
    bid,
    ask,
    mark,
    delta,
    theta,
    gamma,
    vega,
    impliedVolatility,
    volume: quote?.volume ?? null,
    openInterest: quote?.openInterest ?? null,
    providerEventAt: quote?.providerEventAt ?? null,
    receivedAt: quote?.receivedAt ?? null,
    marketSession: screening.marketSession,
    dataQuality,
    flags: {
      crossedMarket,
      missingBid,
      missingAsk,
      invalidPrice,
      staleInputs: screening.staleInputs,
      missingProviderTimestamp: screening.missingProviderTimestamp,
      quoteGreekMismatch: screening.quoteGreekMismatch || unverifiedGreeks,
      missingGreeks,
      unverifiedGreeks,
      afterHoursSnapshot: screening.afterHoursSnapshot || observationFreshness === 'previous-session',
      fromCache: quote?.fromCache === true,
      actionable:
        screening.actionable &&
        dataQuality === 'usable' &&
        !missingGreeks &&
        observationFreshness === 'current-session' &&
        greekVerification === 'aligned' &&
        !hardReject,
    },
    calculations: {
      intrinsicValue: intrinsic,
      estimatedPurchaseCost: purchaseCost,
      extrinsicValue: extrinsicPerShare,
      intrinsicPercent: intrinsicPct,
      bidAskSpreadDollars: spreadDollars,
      bidAskSpreadPercent: spreadPct,
      expirationBreakEven: breakEven,
      daysToExpiration: dte,
      strikeDistance: distance,
      downsideMoneyness15: down15,
      downsideMoneyness20: down20,
      downsideMoneyness30: down30,
      deltaCapitalExposure: exposure,
      midpoint: midpoint(bid, ask),
      quoteSourceLabel: quote?.sourceLabel ?? 'no quote',
    },
    outcome,
    label: DISCOVERY_OUTCOME_LABELS[outcome],
    visible: true,
    usableForComparison: outcome !== 'incomplete' && !hardReject,
    withinExploration: row.withinExploration,
    reasons,
    metrics: row.metrics,
    pmccReason: row.pmccReason,
    meetsConfiguredNumericRequirements,
    liquidityUnassessed,
    observationFreshness,
    greekVerification,
    greekProviderEventAt: quote?.greekEventAt ?? null,
    validationIssues,
  };
}

export function incompleteUnsupportedCandidate(
  contract: NestedChainContract,
  profile: StrategyProfile,
  tolerances: DiscoveryTolerances,
  asOfDate: string,
  now: Date,
  screeningFreshnessSeconds: number,
): FinderCandidate {
  return buildFinderCandidate({
    contract,
    underlyingPrice: null,
    quote: null,
    profile,
    tolerances,
    asOfDate,
    now,
    screeningFreshnessSeconds,
  });
}
