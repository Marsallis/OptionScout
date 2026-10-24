/**
 * Teaching P/L for a long call, or a long call plus a short call.
 * Expiration value is intrinsic. Earlier dates use Black-Scholes with rate 0.
 * This is not a quote and not an order.
 */

export interface RiskLeg {
  side: 'long' | 'short';
  strike: number;
  daysToExpiration: number;
  entryPremium: number;
  iv: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface RiskGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * abs);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return 0.5 * (1 + sign * erf);
}

/** European call, rate 0. At or after expiration, intrinsic only. */
export function callMark(spot: number, strike: number, years: number, vol: number): number {
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || spot <= 0 || strike <= 0) return 0;
  if (years <= 0 || vol <= 0) return Math.max(0, spot - strike);
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + 0.5 * vol * vol * years) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  return Math.max(0, spot * normCdf(d1) - strike * normCdf(d2));
}

export function netEntryDebit(legs: readonly RiskLeg[], multiplier = 100): number {
  return legs.reduce((sum, leg) => {
    const signed = leg.side === 'long' ? leg.entryPremium : -leg.entryPremium;
    return sum + signed * multiplier;
  }, 0);
}

export function legMark(leg: RiskLeg, spot: number, daysPassed: number, ivChangePercent: number): number {
  const remainingDays = leg.daysToExpiration - daysPassed;
  const years = Math.max(0, remainingDays) / 365;
  const vol = Math.max(0, leg.iv * (1 + ivChangePercent / 100));
  return callMark(spot, leg.strike, years, vol);
}

export function scenarioPnl(input: {
  spot: number;
  daysPassed: number;
  ivChangePercent: number;
  legs: readonly RiskLeg[];
  multiplier?: number;
}): number {
  const multiplier = input.multiplier ?? 100;
  const value = input.legs.reduce((sum, leg) => {
    const mark = legMark(leg, input.spot, input.daysPassed, input.ivChangePercent);
    const signed = leg.side === 'long' ? mark : -mark;
    return sum + signed * multiplier;
  }, 0);
  return value - netEntryDebit(input.legs, multiplier);
}

export function pnlSeries(input: {
  spots: readonly number[];
  daysPassed: number;
  ivChangePercent: number;
  legs: readonly RiskLeg[];
  multiplier?: number;
}): Array<{ spot: number; pnl: number }> {
  return input.spots.map((spot) => ({
    spot,
    pnl: scenarioPnl({
      spot,
      daysPassed: input.daysPassed,
      ivChangePercent: input.ivChangePercent,
      legs: input.legs,
      multiplier: input.multiplier,
    }),
  }));
}

export function netGreeks(legs: readonly RiskLeg[]): RiskGreeks {
  const fields = ['delta', 'gamma', 'theta', 'vega'] as const;
  const result: RiskGreeks = { delta: null, gamma: null, theta: null, vega: null };
  for (const field of fields) {
    if (legs.some((leg) => leg[field] == null)) continue;
    result[field] = legs.reduce((sum, leg) => {
      const value = leg[field] ?? 0;
      return sum + (leg.side === 'long' ? value : -value);
    }, 0);
  }
  return result;
}

export function spotGrid(center: number, count = 21): number[] {
  const low = Math.max(1, center * 0.5);
  const high = Math.max(low + 1, center * 1.5);
  const steps = Math.max(2, count);
  return Array.from({ length: steps }, (_, index) => {
    const price = low + ((high - low) * index) / (steps - 1);
    return Math.round(price * 100) / 100;
  });
}
