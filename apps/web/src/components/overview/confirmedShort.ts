import type { PortfolioPosition } from '@optionscout/shared';

/** A confirmed short is an open leg only while reconstruction still shows it open. */
export function confirmedShortLeg(
  shortSymbols: readonly string[],
  positions: Array<Pick<PortfolioPosition, 'symbol' | 'direction'>>,
): { activeSymbol: string | null; closed: boolean } {
  const symbol = shortSymbols[0] ?? null;
  const linked = symbol ? positions.find((position) => position.symbol === symbol) : undefined;
  if (!linked || linked.direction === 'flat') {
    return { activeSymbol: null, closed: linked?.direction === 'flat' };
  }
  return { activeSymbol: linked.symbol, closed: false };
}
