/**
 * Short, beginner-friendly term explanations for Finder UI.
 * Tied to OptionScout formulas where relevant — no external research.
 */

export const FINDER_GLOSSARY = {
  leaps: {
    title: 'LEAPS',
    text: 'Long-term Equity Anticipation Securities — call or put options that typically expire in about a year or more. OptionScout focuses on long-dated call options for stock-like upside with defined premium at risk.',
  },
  callOption: {
    title: 'Call option',
    text: 'A contract that gives you the right, but not the obligation, to buy 100 shares (usual U.S. equity multiplier) of the underlying stock at a fixed strike price before expiration. Buying a call does not mean you already own the shares.',
  },
  put: {
    title: 'Put option',
    text: 'A contract that gives you the right, but not the obligation, to sell shares at the strike price before expiration. A put can gain value when the stock falls. OptionScout’s research desk is built around long calls, not a recommendation to buy puts.',
  },
  expiration: {
    title: 'Expiration',
    text: 'The last day the contract is valid. After expiration, a call that finished out of the money is worth nothing. A call that finished in the money is settled by the rules of that option. Time left is usually shown as days to expiration.',
  },
  strike: {
    title: 'Strike price',
    text: 'The fixed price per share at which you may buy the stock if you exercise the call. For a call, intrinsic value appears when the stock trades above the strike.',
  },
  multiplier: {
    title: 'Contract multiplier',
    text: 'How many shares one option contract controls. Standard U.S. equity options usually use 100, so a $44.45 ask means about $4,445 of capital at the ask for one contract.',
  },
  premium: {
    title: 'Premium',
    text: 'The price of the option. OptionScout estimates purchase cost as ask × multiplier. That is not a guaranteed fill and excludes brokerage fees.',
  },
  intrinsic: {
    title: 'Intrinsic value',
    text: 'For a call: max(stock − strike, 0) per share. Multiplied by 100 it is the in-the-money amount per contract. Intrinsic value is not protected money — the option can still expire worthless or be sold for less than you paid.',
  },
  extrinsic: {
    title: 'Extrinsic value',
    text: 'Premium above intrinsic value (time and volatility premium). Extrinsic value can shrink even if the stock does not move. Formula: ask − intrinsic (per share).',
  },
  delta: {
    title: 'Delta',
    text: 'How much the option price tends to change when the stock moves $1, all else equal. Higher call delta (for example 0.80+) usually tracks the stock more closely and often costs more.',
  },
  theta: {
    title: 'Theta',
    text: 'Approximate daily time decay of the option premium. Long calls usually have negative theta — time passing can reduce extrinsic value.',
  },
  iv: {
    title: 'Implied volatility',
    text: 'The volatility the market is pricing into the option. Higher IV usually means richer extrinsic premium. OptionScout does not invent IV when the provider omits it.',
  },
  spread: {
    title: 'Bid/ask spread',
    text: 'The gap between what buyers bid and sellers ask. A wider spread can mean more trading friction. OptionScout reports ask-based purchase cost and shows spread dollars and percent when both sides are valid.',
  },
  breakeven: {
    title: 'Expiration break-even',
    text: 'For a long call held to expiration: strike + premium paid per share (using the ask in OptionScout). The stock must finish above this level at expiration for the call to show a profit before fees, ignoring earlier sale.',
  },
  openInterest: {
    title: 'Open interest',
    text: 'Number of open contracts still outstanding. When the Finder quote path does not supply it, OptionScout labels liquidity Unassessed — never as passed.',
  },
  pmcc: {
    title: 'PMCC',
    text: 'Poor Man’s Covered Call: own a deep ITM LEAPS call for upside exposure and optionally sell shorter-dated calls against it for premium. The LEAPS does not automatically remove assignment or short-call risk.',
  },
  assignment: {
    title: 'Assignment risk',
    text: 'If you sell a call, the buyer may exercise and you can be assigned a short stock position. Early assignment risk rises around dividends. A long LEAPS does not erase that obligation on the short call.',
  },
} as const;

export type FinderGlossaryKey = keyof typeof FINDER_GLOSSARY;
