export type OptionRight = 'call' | 'put';

export interface NestedChainContract {
  underlying: string;
  rootSymbol: string;
  occSymbol: string;
  streamerSymbol: string | null;
  optionType: OptionRight;
  strike: string;
  expiration: string;
  daysToExpiration: number | null;
  multiplier: number;
  chainType: string;
  settlementType: string | null;
  expirationType: string | null;
  deliverables: NestedDeliverable[];
  standardContract: boolean;
  supportStatus: 'supported' | 'unsupported-adjusted' | 'missing-streamer';
  supportNote: string;
  /** Nested chain does not include these fields; remain unknown unless a flat instrument lookup supplies them. */
  active: boolean | null;
  closingOnly: boolean | null;
}

export interface NestedDeliverable {
  id: number | null;
  amount: string | null;
  deliverableType: string | null;
  description: string | null;
  instrumentType: string | null;
  percent: string | null;
  rootSymbol: string | null;
  symbol: string | null;
}

export interface ParsedNestedChain {
  underlying: string;
  contracts: NestedChainContract[];
  discovered: number;
  standardCalls: number;
  putsDiscovered: number;
  unsupportedAdjusted: number;
  missingStreamer: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function moneyFrom(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const [whole, fraction = ''] = value.trim().split('.');
    return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
  }
  return null;
}

function parseDeliverables(value: unknown): NestedDeliverable[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item) ?? {};
    return {
      id: asNumber(row.id),
      amount: row.amount == null ? null : String(row.amount),
      deliverableType: asString(row['deliverable-type']),
      description: asString(row.description),
      instrumentType: asString(row['instrument-type']),
      percent: row.percent == null ? null : String(row.percent),
      rootSymbol: asString(row['root-symbol']),
      symbol: asString(row.symbol),
    };
  });
}

function isStandardEquityDeliverable(deliverables: NestedDeliverable[], underlying: string, multiplier: number): boolean {
  if (multiplier !== 100) return false;
  if (deliverables.length === 0) return true;
  if (deliverables.length !== 1) return false;
  const only = deliverables[0]!;
  const amountOk = only.amount === '100' || only.amount === '100.0' || only.amount === '100.00';
  const equityOk = (only.instrumentType ?? '').toLowerCase().includes('equity') || (only.deliverableType ?? '').toLowerCase() === 'stock';
  const symbolOk = only.symbol == null || only.symbol === underlying || only.rootSymbol === underlying;
  return amountOk && equityOk && symbolOk;
}

function classifySupport(input: {
  chainType: string;
  multiplier: number;
  deliverables: NestedDeliverable[];
  underlying: string;
  streamerSymbol: string | null;
  optionType: OptionRight;
}): { standardContract: boolean; supportStatus: NestedChainContract['supportStatus']; supportNote: string } {
  const standard =
    input.chainType.toLowerCase() === 'standard' &&
    isStandardEquityDeliverable(input.deliverables, input.underlying, input.multiplier);
  if (!standard) {
    return {
      standardContract: false,
      supportStatus: 'unsupported-adjusted',
      supportNote:
        'Adjusted or unusual deliverables are not treated as a standard 100-share equity option in this phase.',
    };
  }
  if (input.optionType === 'put') {
    return {
      standardContract: true,
      supportStatus: 'supported',
      supportNote: 'Put contracts are discovered and counted but not quote-subscribed for long-call LEAPS evaluation.',
    };
  }
  if (!input.streamerSymbol) {
    return {
      standardContract: true,
      supportStatus: 'missing-streamer',
      supportNote: 'Official streamer symbol is missing. The contract is not subscribed and streamer symbols are never guessed.',
    };
  }
  return {
    standardContract: true,
    supportStatus: 'supported',
    supportNote: 'Standard equity-option call with an official streamer symbol.',
  };
}

export function nestedChainPath(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed === '' || trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('Underlying symbol is not valid.');
  }
  return `/option-chains/${encodeURIComponent(trimmed)}/nested`;
}

export function parseNestedOptionChain(payload: unknown, requestedUnderlying: string): ParsedNestedChain {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : null;
  if (!items) {
    throw new Error('The option-chain response did not include nested items.');
  }
  if (items.length === 0) {
    return {
      underlying: requestedUnderlying.toUpperCase(),
      contracts: [],
      discovered: 0,
      standardCalls: 0,
      putsDiscovered: 0,
      unsupportedAdjusted: 0,
      missingStreamer: 0,
    };
  }

  const contracts: NestedChainContract[] = [];
  const seen = new Set<string>();
  let underlying = requestedUnderlying.toUpperCase();

  for (const item of items) {
    const chain = asRecord(item);
    if (!chain) continue;
    const chainUnderlying = asString(chain['underlying-symbol']) ?? underlying;
    underlying = chainUnderlying.toUpperCase();
    const rootSymbol = asString(chain['root-symbol']) ?? underlying;
    const chainType = asString(chain['option-chain-type']) ?? 'Unknown';
    const multiplier = asNumber(chain['shares-per-contract']) ?? 100;
    const deliverables = parseDeliverables(chain.deliverables);
    const expirations = Array.isArray(chain.expirations) ? chain.expirations : [];

    for (const expirationRow of expirations) {
      const expiration = asRecord(expirationRow);
      if (!expiration) continue;
      const expirationDate = asString(expiration['expiration-date']);
      if (!expirationDate) continue;
      const daysToExpiration = asNumber(expiration['days-to-expiration']);
      const settlementType = asString(expiration['settlement-type']);
      const expirationType = asString(expiration['expiration-type']);
      const strikes = Array.isArray(expiration.strikes) ? expiration.strikes : [];

      for (const strikeRow of strikes) {
        const strike = asRecord(strikeRow);
        if (!strike) continue;
        const strikePrice = moneyFrom(strike['strike-price']);
        if (!strikePrice) continue;

        const sides: Array<{ optionType: OptionRight; occKey: string; streamerKey: string }> = [
          { optionType: 'call', occKey: 'call', streamerKey: 'call-streamer-symbol' },
          { optionType: 'put', occKey: 'put', streamerKey: 'put-streamer-symbol' },
        ];

        for (const side of sides) {
          const occSymbol = asString(strike[side.occKey]);
          if (!occSymbol) continue;
          if (seen.has(occSymbol)) continue;
          seen.add(occSymbol);
          const streamerSymbol = asString(strike[side.streamerKey]);
          const support = classifySupport({
            chainType,
            multiplier,
            deliverables,
            underlying,
            streamerSymbol,
            optionType: side.optionType,
          });
          contracts.push({
            underlying,
            rootSymbol,
            occSymbol,
            streamerSymbol,
            optionType: side.optionType,
            strike: strikePrice,
            expiration: expirationDate,
            daysToExpiration,
            multiplier,
            chainType,
            settlementType,
            expirationType,
            deliverables,
            standardContract: support.standardContract,
            supportStatus: support.supportStatus,
            supportNote: support.supportNote,
            active: null,
            closingOnly: null,
          });
        }
      }
    }
  }

  const standardCalls = contracts.filter((row) => row.optionType === 'call' && row.supportStatus === 'supported').length;
  const putsDiscovered = contracts.filter((row) => row.optionType === 'put').length;
  const unsupportedAdjusted = contracts.filter((row) => row.supportStatus === 'unsupported-adjusted').length;
  const missingStreamer = contracts.filter((row) => row.supportStatus === 'missing-streamer').length;

  return {
    underlying,
    contracts,
    discovered: contracts.length,
    standardCalls,
    putsDiscovered,
    unsupportedAdjusted,
    missingStreamer,
  };
}
