/**
 * Transparent long-call calculations for the LEAPS Finder.
 * Purchase cost uses the ask, never a midpoint fill assumption.
 */

const moneyPattern = /^-?\d+(\.\d{1,4})?$/;

function parseDecimal(value: string | null | undefined): { whole: bigint; scale: number } | null {
  if (value == null || value === '' || !moneyPattern.test(value)) return null;
  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [wholePart, fractionPart = ''] = raw.split('.');
  const scale = fractionPart.length;
  const digits = BigInt(wholePart + fractionPart.padEnd(scale, '0'));
  return { whole: negative ? -digits : digits, scale };
}

function align(a: { whole: bigint; scale: number }, b: { whole: bigint; scale: number }): { left: bigint; right: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  const left = a.whole * 10n ** BigInt(scale - a.scale);
  const right = b.whole * 10n ** BigInt(scale - b.scale);
  return { left, right, scale };
}

function formatScaled(value: bigint, scale: number, money = false): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const text = absolute.toString().padStart(scale + 1, '0');
  const whole = text.slice(0, text.length - scale) || '0';
  const fraction = scale === 0 ? '' : text.slice(text.length - scale);
  let out = scale === 0 ? whole : `${whole}.${fraction}`;
  if (money) {
    const parts = out.split('.');
    const frac = (parts[1] ?? '').padEnd(2, '0').slice(0, 2);
    out = `${parts[0]}.${frac}`;
  } else if (fraction) {
    out = out.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  return negative ? `-${out}` : out;
}

export function maxZero(value: string | null): string | null {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  return parsed.whole < 0n ? formatScaled(0n, parsed.scale) : formatScaled(parsed.whole, parsed.scale);
}

/** Intrinsic value per share = max(stock − strike, 0). */
export function intrinsicValue(stockPrice: string | null, strike: string | null): string | null {
  const stock = parseDecimal(stockPrice);
  const strikePrice = parseDecimal(strike);
  if (!stock || !strikePrice) return null;
  const { left, right, scale } = align(stock, strikePrice);
  const diff = left - right;
  return diff <= 0n ? formatScaled(0n, Math.max(scale, 2), true) : formatScaled(diff, scale, true);
}

/** Estimated purchase cost = ask × multiplier (one contract). */
export function estimatedPurchaseCost(ask: string | null, multiplier: number | null): string | null {
  const premium = parseDecimal(ask);
  if (!premium || multiplier == null || !Number.isInteger(multiplier) || multiplier <= 0) return null;
  const scaled = premium.whole * BigInt(multiplier);
  return formatScaled(scaled, premium.scale, true);
}

/** Extrinsic value per share = premium − intrinsic. */
export function extrinsicValue(premium: string | null, intrinsic: string | null): string | null {
  const price = parseDecimal(premium);
  const intrinsicPrice = parseDecimal(intrinsic);
  if (!price || !intrinsicPrice) return null;
  const { left, right, scale } = align(price, intrinsicPrice);
  return formatScaled(left - right, scale, true);
}

/** Intrinsic percentage = intrinsic / premium × 100. */
export function intrinsicPercent(intrinsic: string | null, premium: string | null): string | null {
  const intrinsicPrice = parseDecimal(intrinsic);
  const price = parseDecimal(premium);
  if (!intrinsicPrice || !price || price.whole === 0n) return null;
  const { left, right, scale } = align(intrinsicPrice, price);
  const numerator = left * 10000n;
  const denominator = right;
  if (denominator === 0n) return null;
  const ratio = numerator / denominator;
  // ratio is percent × 100 (two decimal places of percent)
  return formatScaled(ratio, 2);
}

/** Bid/ask spread in dollars. Null when the market is crossed or prices are missing. */
export function bidAskSpreadDollars(bid: string | null, ask: string | null): string | null {
  const bidPrice = parseDecimal(bid);
  const askPrice = parseDecimal(ask);
  if (!bidPrice || !askPrice) return null;
  const { left, right, scale } = align(askPrice, bidPrice);
  if (right > left) return null;
  return formatScaled(left - right, scale, true);
}

/** Bid/ask spread as percent of midpoint. Null when crossed, missing, or midpoint is zero. */
export function bidAskSpreadPercent(bid: string | null, ask: string | null): string | null {
  const bidPrice = parseDecimal(bid);
  const askPrice = parseDecimal(ask);
  if (!bidPrice || !askPrice) return null;
  const { left: askAligned, right: bidAligned, scale } = align(askPrice, bidPrice);
  if (bidAligned > askAligned) return null;
  const spread = askAligned - bidAligned;
  const mid = (askAligned + bidAligned) / 2n;
  if (mid === 0n) return null;
  const ratio = (spread * 10000n) / mid;
  return formatScaled(ratio, 2);
}

/** Expiration break-even = strike + premium paid per share (ask). */
export function expirationBreakEven(strike: string | null, premium: string | null): string | null {
  const strikePrice = parseDecimal(strike);
  const price = parseDecimal(premium);
  if (!strikePrice || !price) return null;
  const { left, right, scale } = align(strikePrice, price);
  return formatScaled(left + right, scale, true);
}

/** Calendar days from asOf (YYYY-MM-DD) to expiration (YYYY-MM-DD). */
export function daysToExpiration(expiration: string, asOf: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const start = Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, Number(asOf.slice(8, 10)));
  const end = Date.UTC(Number(expiration.slice(0, 4)), Number(expiration.slice(5, 7)) - 1, Number(expiration.slice(8, 10)));
  return Math.round((end - start) / 86_400_000);
}

/** Strike distance from stock: stock − strike (positive when ITM for a call). */
export function strikeDistance(stockPrice: string | null, strike: string | null): string | null {
  const stock = parseDecimal(stockPrice);
  const strikePrice = parseDecimal(strike);
  if (!stock || !strikePrice) return null;
  const { left, right, scale } = align(stock, strikePrice);
  return formatScaled(left - right, scale, true);
}

/** Stock price after a percent decline. */
export function downsidePrice(stockPrice: string | null, declinePercent: string): string | null {
  const stock = parseDecimal(stockPrice);
  const decline = parseDecimal(declinePercent);
  if (!stock || !decline || decline.whole < 0n) return null;
  const { left, right, scale } = align(stock, decline);
  // price * (100 - decline) / 100
  const factorScale = Math.max(scale, 2);
  const price = left * 10n ** BigInt(factorScale - scale);
  const pct = right * 10n ** BigInt(factorScale - scale);
  const remaining = 100n * 10n ** BigInt(factorScale) - pct;
  if (remaining < 0n) return null;
  const result = (price * remaining) / (100n * 10n ** BigInt(factorScale));
  return formatScaled(result, factorScale, true);
}

/** (downsidePrice − strike) / downsidePrice as a percentage. */
export function downsideMoneynessPercent(stockPrice: string | null, strike: string | null, declinePercent: string): string | null {
  const down = downsidePrice(stockPrice, declinePercent);
  const strikePrice = parseDecimal(strike);
  const downPrice = parseDecimal(down);
  if (!downPrice || !strikePrice || downPrice.whole === 0n) return null;
  const { left, right, scale } = align(downPrice, strikePrice);
  const diff = left - right;
  const ratio = (diff * 10000n) / left;
  return formatScaled(ratio, 2);
}

/**
 * Delta exposure relative to capital: (delta × underlying price) / ask.
 * Null when ask is missing or zero.
 */
export function deltaCapitalExposure(delta: string | null, stockPrice: string | null, ask: string | null): string | null {
  const d = parseDecimal(delta);
  const stock = parseDecimal(stockPrice);
  const premium = parseDecimal(ask);
  if (!d || !stock || !premium || premium.whole === 0n) return null;
  const maxScale = Math.max(d.scale, stock.scale, premium.scale);
  const dAligned = d.whole * 10n ** BigInt(maxScale - d.scale);
  const stockAligned = stock.whole * 10n ** BigInt(maxScale - stock.scale);
  const askAligned = premium.whole * 10n ** BigInt(maxScale - premium.scale);
  const ratio = (dAligned * stockAligned) / askAligned;
  return formatScaled(ratio, maxScale);
}

export function midpoint(bid: string | null, ask: string | null): string | null {
  const bidPrice = parseDecimal(bid);
  const askPrice = parseDecimal(ask);
  if (!bidPrice || !askPrice) return null;
  const { left, right, scale } = align(askPrice, bidPrice);
  return formatScaled((left + right) / 2n, scale, true);
}

export function isCrossedMarket(bid: string | null, ask: string | null): boolean {
  const bidPrice = parseDecimal(bid);
  const askPrice = parseDecimal(ask);
  if (!bidPrice || !askPrice) return false;
  const { left, right } = align(askPrice, bidPrice);
  return right > left;
}

export function isInvalidPrice(value: string | null): boolean {
  const parsed = parseDecimal(value);
  return parsed != null && parsed.whole <= 0n;
}

/** Default: 5¢ — ignore tiny rounding noise; do not silently clamp intrinsic%. */
export const IMPOSSIBLE_CALL_INTRINSIC_TOLERANCE = '0.05';
/** Default: allow displayed intrinsic% up to 100.05 before treating as impossible. */
export const IMPOSSIBLE_CALL_INTRINSIC_PERCENT_CEILING = '100.05';

/**
 * True when a standard equity call's ask-implied premium cannot contain the computed intrinsic
 * (intrinsic > ask + tolerance, or intrinsicPercent > 100 + tolerance). Values are preserved;
 * callers must mark dataQuality inconsistent/invalid — never silently cap intrinsic% at 100.
 */
export function isImpossibleStandardCallIntrinsic(input: {
  optionType: 'call' | 'put';
  standardContract: boolean;
  supportStatus: string;
  intrinsicPerShare: string | null;
  ask: string | null;
  intrinsicPercent: string | null;
  tolerancePerShare?: string;
  percentCeiling?: string;
}): boolean {
  if (input.optionType !== 'call' || !input.standardContract || input.supportStatus !== 'supported') {
    return false;
  }
  const intrinsic = parseDecimal(input.intrinsicPerShare);
  const ask = parseDecimal(input.ask);
  if (!intrinsic || !ask || ask.whole <= 0n) return false;

  const tolerance = parseDecimal(input.tolerancePerShare ?? IMPOSSIBLE_CALL_INTRINSIC_TOLERANCE) ?? {
    whole: 5n,
    scale: 2,
  };
  const { left: intrinsicAligned, right: askAligned, scale } = align(intrinsic, ask);
  const tolAligned = tolerance.whole * 10n ** BigInt(scale - tolerance.scale);
  if (intrinsicAligned > askAligned + tolAligned) return true;

  const pct = parseDecimal(input.intrinsicPercent);
  const ceiling = parseDecimal(input.percentCeiling ?? IMPOSSIBLE_CALL_INTRINSIC_PERCENT_CEILING);
  if (pct && ceiling) {
    const { left: pctAligned, right: ceilAligned } = align(pct, ceiling);
    if (pctAligned > ceilAligned) return true;
  }
  return false;
}

/**
 * Equity spot for intrinsic/moneyness: prefer mark, then tight mid, then bid, then ask.
 * Never prefer a wide ask over a mark or a bid.
 */
export function selectEquitySpotPrice(
  bid: string | null,
  ask: string | null,
  mark: string | null,
): string | null {
  const markPrice = parseDecimal(mark);
  if (markPrice && markPrice.whole > 0n) {
    return formatScaled(markPrice.whole, markPrice.scale, true);
  }
  const bidPrice = parseDecimal(bid);
  const askPrice = parseDecimal(ask);
  if (bidPrice && askPrice && bidPrice.whole > 0n && askPrice.whole > 0n && !isCrossedMarket(bid, ask)) {
    const { left: askAligned, right: bidAligned, scale } = align(askPrice, bidPrice);
    const spread = askAligned - bidAligned;
    const mid = (askAligned + bidAligned) / 2n;
    const twoPct = mid / 50n; // 2% of midpoint
    const twoDollars = 2n * 10n ** BigInt(scale);
    if (spread > twoPct || spread > twoDollars) {
      return formatScaled(bidAligned, scale, true);
    }
    return midpoint(bid, ask);
  }
  if (bidPrice && bidPrice.whole > 0n) return formatScaled(bidPrice.whole, bidPrice.scale, true);
  if (askPrice && askPrice.whole > 0n) return formatScaled(askPrice.whole, askPrice.scale, true);
  return null;
}
