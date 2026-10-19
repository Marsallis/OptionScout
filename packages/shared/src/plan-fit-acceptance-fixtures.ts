/**
 * Mocked previous-session reproductions for Core Plan Fit acceptance QA.
 * NEVER masquerades as live market data.
 */

import type { FinderCandidate } from './finder.js';
import { SAL_PMCC_DEEP_ITM, type StrategyProfile } from './strategy-profile.js';
import { buildWmtAnalysisCandidate } from './wmt-analysis-fixture.js';

export const PLAN_FIT_ACCEPTANCE_NOTICE =
  'SIMULATED PREVIOUS-SESSION FIXTURE — NOT LIVE MARKET DATA. Used only for Core Plan Fit acceptance verification.';

/**
 * Owner-style saved revision used in acceptance cases where hard max is $7,500
 * (CVX $7,330 must pass hard max while missing ideal $6,000).
 */
export const ACCEPTANCE_SAVED_PROFILE: StrategyProfile = {
  ...SAL_PMCC_DEEP_ITM,
  revision: 2,
  kind: 'custom',
  originTemplateId: SAL_PMCC_DEEP_ITM.id,
  isDefault: true,
  name: 'Sal PMCC — Deep ITM (saved rev 2 fixture)',
  hard: {
    ...SAL_PMCC_DEEP_ITM.hard,
    maxContractCost: '7500.00',
  },
};

/** WMT Jan 2029 $70 — expected Core Plan Fit 6/6 on ACCEPTANCE_SAVED_PROFILE / defaults with ideal $6,000. */
export function buildWmtJan2029AcceptanceCandidate(
  overrides: Partial<FinderCandidate> = {},
): FinderCandidate {
  const base = buildWmtAnalysisCandidate({
    id: 'fixture-wmt-70c-2029-01-19',
    underlying: 'WMT',
    occSymbol: 'WMT   290119C00070000',
    streamerSymbol: '.WMT290119C70',
    strike: '70.00',
    expiration: '2029-01-19',
    underlyingPrice: '127.00',
    bid: '56.80',
    ask: '57.30',
    mark: '57.05',
    delta: '0.8721',
    supportNote: PLAN_FIT_ACCEPTANCE_NOTICE,
    calculations: {
      ...buildWmtAnalysisCandidate().calculations,
      intrinsicValue: '57.00',
      estimatedPurchaseCost: '5730.00',
      extrinsicValue: '0.30',
      intrinsicPercent: '84.93',
      bidAskSpreadDollars: '0.50',
      bidAskSpreadPercent: '0.88',
      expirationBreakEven: '127.30',
      daysToExpiration: 825,
      strikeDistance: '57.00',
      midpoint: '57.05',
      quoteSourceLabel: 'SIMULATED WMT Jan 2029 acceptance fixture (not live)',
    },
    metrics: {
      purchaseCost: 5730,
      delta: 0.8721,
      intrinsicPercent: 84.93,
      extrinsicValue: 0.3,
      bidAskSpread: 0.88,
      liquidity: null,
      dte: 825,
      theta: -0.012,
      downsideMoneyness: 15,
      pmccCompatibility: null,
    },
    outcome: 'exact',
    label: 'Exact Match',
    meetsConfiguredNumericRequirements: true,
    observationFreshness: 'previous-session',
    greekVerification: 'aligned',
    marketSession: 'closed',
  });
  return { ...base, ...overrides, calculations: { ...base.calculations, ...overrides.calculations } };
}

/** CVX Jan 2029 $165 — expected Core Plan Fit 5/6 (ideal cost miss) on ACCEPTANCE_SAVED_PROFILE. */
export function buildCvxJan2029AcceptanceCandidate(
  overrides: Partial<FinderCandidate> = {},
): FinderCandidate {
  const base = buildWmtAnalysisCandidate({
    id: 'fixture-cvx-165c-2029-01-19',
    underlying: 'CVX',
    occSymbol: 'CVX   290119C00165000',
    streamerSymbol: '.CVX290119C165',
    strike: '165.00',
    expiration: '2029-01-19',
    underlyingPrice: '225.10',
    bid: '72.80',
    ask: '73.30',
    mark: '73.05',
    delta: '0.8238',
    supportNote: PLAN_FIT_ACCEPTANCE_NOTICE,
    calculations: {
      ...buildWmtAnalysisCandidate().calculations,
      intrinsicValue: '60.10',
      estimatedPurchaseCost: '7330.00',
      extrinsicValue: '13.20',
      intrinsicPercent: '81.89',
      bidAskSpreadDollars: '0.50',
      bidAskSpreadPercent: '0.68',
      expirationBreakEven: '238.30',
      daysToExpiration: 825,
      strikeDistance: '60.10',
      midpoint: '73.05',
      quoteSourceLabel: 'SIMULATED CVX Jan 2029 acceptance fixture (not live)',
    },
    metrics: {
      purchaseCost: 7330,
      delta: 0.8238,
      intrinsicPercent: 81.89,
      extrinsicValue: 13.2,
      bidAskSpread: 0.68,
      liquidity: null,
      dte: 825,
      theta: -0.018,
      downsideMoneyness: 18,
      pmccCompatibility: null,
    },
    outcome: 'near',
    label: 'Near Match',
    meetsConfiguredNumericRequirements: true,
    observationFreshness: 'previous-session',
    greekVerification: 'aligned',
    marketSession: 'closed',
  });
  return { ...base, ...overrides, calculations: { ...base.calculations, ...overrides.calculations } };
}
