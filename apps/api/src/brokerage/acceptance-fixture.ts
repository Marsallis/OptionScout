import type { BrokerageReadClient } from './client.js';

/** Fictional accounts used only when TASTYTRADE_ACCEPTANCE_FIXTURE=true. */
const PRIMARY = 'ZZQA000111';
const OTHER = 'ZZQA000222';
const PRIMARY_SYMBOL = 'ZZT   280121C00155000';
const OTHER_SYMBOL = 'QQQ   280121C00300000';

/**
 * In-process brokerage stand-in for a local acceptance pass.
 * It never calls the network. It stays unused unless the process is started with the fixture flag.
 */
export function createAcceptanceFixture(): BrokerageReadClient {
  return {
    async getJson(path: string) {
      if (path.includes('/orders')) {
        throw new Error('Order routes are not available.');
      }
      if (path === '/customers/me/accounts') {
        return {
          data: {
            items: [
              { account: { 'account-number': PRIMARY, 'account-type-name': 'Individual' }, 'authority-level': 'owner' },
              { account: { 'account-number': OTHER, 'account-type-name': 'IRA' }, 'authority-level': 'owner' },
            ],
          },
        };
      }
      if (path.endsWith('/positions')) {
        const other = path.includes(OTHER);
        return { data: { items: [position(other ? OTHER_SYMBOL : PRIMARY_SYMBOL, other ? 'QQQ' : 'ZZT')] } };
      }
      if (path.endsWith('/transactions')) {
        const other = path.includes(OTHER);
        return {
          data: { items: [trade(other ? OTHER_SYMBOL : PRIMARY_SYMBOL)] },
          pagination: { 'page-offset': 0, 'total-pages': 1 },
        };
      }
      if (path === '/market-data/by-type') {
        return { data: { items: [] } };
      }
      throw new Error('The fictional brokerage fixture does not serve that read.');
    },
  };
}

function position(symbol: string, underlying: string) {
  return {
    symbol,
    'underlying-symbol': underlying,
    'instrument-type': 'Equity Option',
    quantity: '1',
    'quantity-direction': 'Long',
    'average-open-price': '20',
    multiplier: '100',
  };
}

function trade(symbol: string) {
  return {
    id: symbol.startsWith('QQQ') ? 9002 : 9001,
    'transaction-type': 'Trade',
    action: 'Buy to Open',
    symbol,
    'instrument-type': 'Equity Option',
    quantity: '1',
    price: '20.00',
    value: '2000.00',
    'value-effect': 'Debit',
    commission: '0.00',
    'clearing-fees': '0.00',
    'regulatory-fees': '0.00',
    'proprietary-index-option-fees': '0.00',
    'other-fees': '0.00',
    'executed-at': '2026-09-08T14:58:45.000Z',
  };
}
