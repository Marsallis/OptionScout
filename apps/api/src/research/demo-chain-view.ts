import { DEMO_AS_OF, DEMO_DISCLAIMER, daysToExpiration, demoChainSchema, type DemoChain } from '@optionscout/shared';
import { DEMO_SPOT, DEMO_UNDERLYING, DemoFinderQuoteSource, demoNestedChainPayload } from '../finder/demo-chain.js';

interface RawExpiration {
  'expiration-date'?: string;
  strikes?: Array<{ 'strike-price'?: number; call?: string; 'call-streamer-symbol'?: string }>;
}

interface RawItem {
  'option-chain-type'?: string;
  'shares-per-contract'?: number;
  expirations?: RawExpiration[];
}

function occSymbol(expiration: string, strike: number): string {
  const yymmdd = `${expiration.slice(2, 4)}${expiration.slice(5, 7)}${expiration.slice(8, 10)}`;
  const strikeCode = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${DEMO_UNDERLYING}   ${yymmdd}C${strikeCode}`;
}

function streamerSymbol(expiration: string, strike: number, provided?: string): string {
  if (provided && provided.startsWith('.')) return provided;
  const yymmdd = `${expiration.slice(2, 4)}${expiration.slice(5, 7)}${expiration.slice(8, 10)}`;
  const strikeText = Number.isInteger(strike) ? String(strike) : String(strike);
  return `.${DEMO_UNDERLYING}${yymmdd}C${strikeText}`;
}

export async function buildDemoChain(): Promise<DemoChain> {
  const payload = demoNestedChainPayload(DEMO_UNDERLYING) as { data?: { items?: RawItem[] } };
  const asOfDate = DEMO_AS_OF.slice(0, 10);
  const quotes = new DemoFinderQuoteSource(DEMO_SPOT, DEMO_AS_OF, { providerTimestamp: true });
  const contracts: DemoChain['contracts'] = [];
  for (const item of payload.data?.items ?? []) {
    if (item['option-chain-type'] !== 'Standard' || item['shares-per-contract'] !== 100) continue;
    for (const expiration of item.expirations ?? []) {
      const expirationDate = expiration['expiration-date'];
      if (!expirationDate) continue;
      const days = daysToExpiration(expirationDate, asOfDate);
      if (days == null) continue;
      for (const strikeRow of expiration.strikes ?? []) {
        if (!strikeRow.call || strikeRow['strike-price'] == null) continue;
        const strike = Number(strikeRow['strike-price']);
        if (!Number.isFinite(strike) || strike <= 0) continue;
        const streamer = streamerSymbol(expirationDate, strike, strikeRow['call-streamer-symbol']);
        const quote = (await quotes.fetchQuotes([streamer])).get(streamer);
        if (!quote?.bid || !quote.ask) continue;
        if (Number(quote.bid) > Number(quote.ask)) continue;
        contracts.push({
          occ: occSymbol(expirationDate, strike),
          expiration: expirationDate,
          strike,
          daysToExpiration: days,
          bid: quote.bid,
          ask: quote.ask,
          delta: quote.delta,
          gamma: quote.gamma,
          theta: quote.theta,
          vega: quote.vega,
          iv: quote.impliedVolatility,
          simulated: true,
        });
      }
    }
  }
  contracts.sort((left, right) => right.daysToExpiration - left.daysToExpiration || left.strike - right.strike);
  return demoChainSchema.parse({
    underlying: DEMO_UNDERLYING,
    spot: DEMO_SPOT,
    asOf: DEMO_AS_OF,
    simulated: true,
    disclaimer: `${DEMO_DISCLAIMER} The practice chain is the fictional ticker DEMO.`,
    contracts,
  });
}
