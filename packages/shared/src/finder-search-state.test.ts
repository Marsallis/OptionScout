import { describe, expect, it } from 'vitest';
import { effectiveLiveScanEnabled, resolveFinderSearchState } from './finder-search-state.js';

describe('finder search state', () => {
  it('requires sign-in before enabling Find LEAPS', () => {
    const state = resolveFinderSearchState({
      authenticated: false,
      portfolioView: 'brokerage',
      ticker: 'CVX',
      deltaInvalid: false,
      busy: false,
      finderLiveScanInstallAllowed: true,
      finderOnDemandSearchEnabled: true,
      brokerageLiveConfigured: true,
    });
    expect(state.canSearch).toBe(false);
    expect(state.blocker).toBe('signed-out');
    expect(state.primaryLabel).toBe('Sign In to Search');
    expect(state.primaryHref).toBe('/broker');
  });

  it('lets a public simulated demo search DEMO without an owner session', () => {
    const state = resolveFinderSearchState({
      authenticated: false,
      publicSimulatedDemo: true,
      portfolioView: 'demo',
      ticker: 'DEMO',
      deltaInvalid: false,
      busy: false,
      finderLiveScanInstallAllowed: false,
      finderOnDemandSearchEnabled: false,
      brokerageLiveConfigured: false,
    });
    expect(state.canSearch).toBe(true);
    expect(state.blocker).toBe('ready-demo');
  });

  it('blocks real tickers in demo mode with a settings path', () => {
    const state = resolveFinderSearchState({
      authenticated: true,
      portfolioView: 'demo',
      ticker: 'CVX',
      deltaInvalid: false,
      busy: false,
      finderLiveScanInstallAllowed: true,
      finderOnDemandSearchEnabled: true,
      brokerageLiveConfigured: true,
    });
    expect(state.canSearch).toBe(false);
    expect(state.blocker).toBe('demo-mode-real-ticker');
    expect(state.primaryHref).toBe('/settings');
  });

  it('explains install gate separately from owner toggle', () => {
    const installOff = resolveFinderSearchState({
      authenticated: true,
      portfolioView: 'brokerage',
      ticker: 'WMT',
      deltaInvalid: false,
      busy: false,
      finderLiveScanInstallAllowed: false,
      finderOnDemandSearchEnabled: true,
      brokerageLiveConfigured: true,
    });
    expect(installOff.blocker).toBe('live-install-disabled');
    expect(installOff.canSearch).toBe(false);

    const ownerOff = resolveFinderSearchState({
      authenticated: true,
      portfolioView: 'brokerage',
      ticker: 'WMT',
      deltaInvalid: false,
      busy: false,
      finderLiveScanInstallAllowed: true,
      finderOnDemandSearchEnabled: false,
      brokerageLiveConfigured: true,
    });
    expect(ownerOff.blocker).toBe('live-owner-disabled');
    expect(ownerOff.primaryHref).toBe('/settings');
    expect(ownerOff.title).toMatch(/Enable on-demand searches/i);
  });

  it('is ready for live search only when both gates and brokerage are present', () => {
    expect(effectiveLiveScanEnabled(true, true)).toBe(true);
    expect(effectiveLiveScanEnabled(true, false)).toBe(false);
    const state = resolveFinderSearchState({
      authenticated: true,
      portfolioView: 'brokerage',
      ticker: 'QCOM',
      deltaInvalid: false,
      busy: false,
      finderLiveScanInstallAllowed: true,
      finderOnDemandSearchEnabled: true,
      brokerageLiveConfigured: true,
      brokerageConnectedThisProcess: false,
    });
    expect(state.canSearch).toBe(true);
    expect(state.primaryLabel).toBe('Find LEAPS');
    expect(state.message).toMatch(/not a credential failure/i);
  });
});
