/**
 * Beginner catalog of familiar stock collections.
 * These entries describe where an owner can download official holdings.
 * They are not a scannable universe until that file is imported.
 * OptionScout does not fetch or scrape provider sites.
 */

import type { DiscoveryUniverse } from './smart-scan.js';

export type CollectionFundChoice = {
  ticker: string;
  fundName: string;
  provider: string;
  /** Official fund page where the owner downloads a holdings file. */
  holdingsPageUrl: string;
};

export type StockCollectionCatalogEntry = {
  id: string;
  title: string;
  category: 'broad-market' | 'sector';
  summary: string;
  /** One sentence for the collection card. */
  cardLine: string;
  /** Shown so importing holdings is not confused with buying or scanning the ETF. */
  holdingsVersusEtf: string;
  funds: readonly CollectionFundChoice[];
};

export const STOCK_COLLECTION_CATALOG: readonly StockCollectionCatalogEntry[] = [
  {
    id: 'sp500-exposure',
    title: 'S&P 500 exposure',
    category: 'broad-market',
    cardLine: 'Large U.S. companies held inside an S&P 500 fund.',
    summary: 'Large U.S. companies held by an S&P 500 ETF. Import one fund’s official holdings file. This is not a licensed index constituent feed.',
    holdingsVersusEtf: 'Importing holdings searches the stocks inside the ETF. It does not search for LEAPS on IVV, VOO, or SPY themselves.',
    funds: [
      {
        ticker: 'IVV',
        fundName: 'iShares Core S&P 500 ETF',
        provider: 'iShares',
        holdingsPageUrl: 'https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf',
      },
      {
        ticker: 'VOO',
        fundName: 'Vanguard S&P 500 ETF',
        provider: 'Vanguard',
        holdingsPageUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/voo',
      },
      {
        ticker: 'SPY',
        fundName: 'SPDR S&P 500 ETF Trust',
        provider: 'State Street',
        holdingsPageUrl: 'https://www.ssga.com/us/en/intermediary/etfs/funds/spdr-sp-500-etf-trust-spy',
      },
    ],
  },
  {
    id: 'total-us-market',
    title: 'Total U.S. market',
    category: 'broad-market',
    cardLine: 'A very wide list of U.S. companies held inside one total-market fund.',
    summary: 'Broad U.S. stock exposure from Vanguard’s total-market ETF. A full VTI file is thousands of companies. The first scan still looks at 12 companies.',
    holdingsVersusEtf: 'Importing VTI holdings searches those underlying stocks. It does not search for LEAPS on VTI itself.',
    funds: [
      {
        ticker: 'VTI',
        fundName: 'Vanguard Total Stock Market ETF',
        provider: 'Vanguard',
        holdingsPageUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vti',
      },
    ],
  },
  {
    id: 'nasdaq-100-exposure',
    title: 'Nasdaq-100 exposure',
    category: 'broad-market',
    cardLine: 'The companies held inside the Nasdaq-100 fund QQQ.',
    summary: 'The companies inside Invesco QQQ. This is the ETF’s holdings file, not a claim of Nasdaq’s licensed index membership.',
    holdingsVersusEtf: 'Importing QQQ holdings searches those underlying stocks. It does not search for LEAPS on QQQ itself.',
    funds: [
      {
        ticker: 'QQQ',
        fundName: 'Invesco QQQ Trust',
        provider: 'Invesco',
        holdingsPageUrl: 'https://www.invesco.com/qqq-etf/en/about.html',
      },
    ],
  },
  {
    id: 'smaller-companies',
    title: 'Smaller companies',
    category: 'broad-market',
    cardLine: 'Smaller U.S. companies held inside a Russell 2000 fund.',
    summary: 'U.S. smaller companies held by iShares Russell 2000. Import the official holdings file before any company can be scanned from this collection.',
    holdingsVersusEtf: 'Importing IWM holdings searches those underlying stocks. It does not search for LEAPS on IWM itself.',
    funds: [
      {
        ticker: 'IWM',
        fundName: 'iShares Russell 2000 ETF',
        provider: 'iShares',
        holdingsPageUrl: 'https://www.ishares.com/us/products/239710/ishares-russell-2000-etf',
      },
    ],
  },
  {
    id: 'sector-etfs',
    title: 'Sector ETF collections',
    category: 'sector',
    cardLine: 'One industry at a time, from a sector fund’s list of companies.',
    summary: 'One sector at a time, from State Street Select Sector SPDR funds. Each fund needs its own imported holdings file.',
    holdingsVersusEtf: 'Importing a sector ETF’s holdings searches the stocks in that sector fund. It does not search for LEAPS on the sector ETF ticker.',
    funds: [
      { ticker: 'XLK', fundName: 'Technology Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLF', fundName: 'Financial Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLE', fundName: 'Energy Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLV', fundName: 'Health Care Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLY', fundName: 'Consumer Discretionary Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLP', fundName: 'Consumer Staples Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLI', fundName: 'Industrial Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLB', fundName: 'Materials Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLRE', fundName: 'Real Estate Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLU', fundName: 'Utilities Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
      { ticker: 'XLC', fundName: 'Communication Services Select Sector SPDR', provider: 'State Street', holdingsPageUrl: 'https://www.sectorspdrs.com/' },
    ],
  },
];

export function collectionDisplayName(name: string): string {
  const stripped = name.replace(/^Explore:\s*/i, '').trim();
  return stripped || name;
}

export function installedHoldingsForFund(
  saved: readonly DiscoveryUniverse[],
  fundTicker: string,
): DiscoveryUniverse | null {
  const wanted = fundTicker.trim().toUpperCase();
  return (
    saved.find(
      (row) =>
        row.tickers.length > 0 &&
        (row.currentVersion?.fundTicker ?? '').trim().toUpperCase() === wanted,
    ) ?? null
  );
}

/** A collection can be scanned only when imported or curated rows actually exist. */
export function collectionIsReady(universe: { tickers: readonly string[] } | null | undefined): boolean {
  return Boolean(universe && universe.tickers.length > 0);
}

function parseInterpretedPercent(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Largest holdings by interpreted percent of the fund (7.1 means 7.1%).
 * Pass only weights that have already been read with a known scale.
 * This is fund composition, not a forecast. Tickers without an interpreted
 * percent are left out rather than guessed.
 */
export type CompanyMatch = { ticker: string; name: string };

/**
 * Rank company matches, then keep at most `limit` suggestions.
 * An exact ticker or name is ranked ahead of partial matches, so a company at the
 * end of a large collection is still returned when the query names it.
 * The limit only shortens the suggestion list. It does not drop a better match.
 */
export function rankCompanyMatches<T extends CompanyMatch>(options: readonly T[], query: string, limit: number): T[] {
  const cap = Math.max(0, limit);
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, cap);
  const scored: Array<{ row: T; score: number; index: number }> = [];
  options.forEach((row, index) => {
    const ticker = row.ticker.toLowerCase();
    const name = row.name.toLowerCase();
    let score = 4;
    if (ticker === q || name === q) score = 0;
    else if (ticker.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (ticker.includes(q) || name.includes(q)) score = 3;
    else return;
    scored.push({ row, score, index });
  });
  scored.sort((left, right) => left.score - right.score || left.index - right.index);
  return scored.slice(0, cap).map((row) => row.row);
}

export function topHoldingsByWeight(
  tickers: readonly string[],
  weights: Readonly<Record<string, string>>,
  count: number,
): string[] {
  const ranked = tickers
    .map((ticker, index) => ({ ticker, index, weight: parseInterpretedPercent(weights[ticker]) }))
    .filter((row): row is { ticker: string; index: number; weight: number } => row.weight != null);
  ranked.sort((left, right) => right.weight - left.weight || left.index - right.index);
  return ranked.slice(0, Math.max(0, count)).map((row) => row.ticker);
}
