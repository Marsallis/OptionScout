/**
 * Beginner-facing LEAPS Finder primary-action readiness.
 * Does not invent brokerage connectivity — callers supply observed state.
 */

export type FinderSearchBlocker =
  | 'signed-out'
  | 'demo-mode-real-ticker'
  | 'live-install-disabled'
  | 'live-owner-disabled'
  | 'brokerage-unavailable'
  | 'empty-ticker'
  | 'invalid-delta'
  | 'busy'
  | 'ready-demo'
  | 'ready-live';

export interface FinderSearchInputs {
  authenticated: boolean;
  portfolioView: 'demo' | 'brokerage';
  ticker: string;
  deltaInvalid: boolean;
  busy: boolean;
  /** Process env FINDER_LIVE_SCAN */
  finderLiveScanInstallAllowed: boolean;
  /** Owner SQLite setting */
  finderOnDemandSearchEnabled: boolean;
  /** Brokerage client configured and liveEnabled */
  brokerageLiveConfigured: boolean;
  /** Optional: connection already succeeded this process */
  brokerageConnectedThisProcess?: boolean;
}

export interface FinderSearchState {
  blocker: FinderSearchBlocker;
  canSearch: boolean;
  primaryLabel: string;
  primaryHref: string | null;
  severity: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  nextStep: string;
}

const DEMO_TICKER = 'DEMO';

export function normalizeFinderTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function isDemoOnlyTicker(ticker: string): boolean {
  return normalizeFinderTicker(ticker) === DEMO_TICKER;
}

/** Effective gate used by the API for live nested-chain scans. */
export function effectiveLiveScanEnabled(installAllowed: boolean, ownerEnabled: boolean): boolean {
  return installAllowed && ownerEnabled;
}

export function resolveFinderSearchState(input: FinderSearchInputs): FinderSearchState {
  const ticker = normalizeFinderTicker(input.ticker);

  if (input.busy) {
    return {
      blocker: 'busy',
      canSearch: false,
      primaryLabel: 'Searching…',
      primaryHref: null,
      severity: 'info',
      title: 'Search in progress',
      message: 'Evaluating long-dated calls for this ticker.',
      nextStep: 'You can cancel safely if you need to stop.',
    };
  }

  if (!input.authenticated) {
    return {
      blocker: 'signed-out',
      canSearch: false,
      primaryLabel: 'Sign In to Search',
      primaryHref: '/broker',
      severity: 'warning',
      title: 'Sign in required',
      message: 'On-demand LEAPS searches need the local owner session.',
      nextStep: 'Open Broker & Data, sign in with your owner passphrase, then return here.',
    };
  }

  if (ticker.length === 0) {
    return {
      blocker: 'empty-ticker',
      canSearch: false,
      primaryLabel: 'Find LEAPS',
      primaryHref: null,
      severity: 'info',
      title: 'Enter a stock ticker',
      message: 'Choose a symbol such as CVX, QCOM, AAPL, or WMT (or DEMO in demo mode).',
      nextStep: 'Type a ticker, then click Find LEAPS.',
    };
  }

  if (input.deltaInvalid) {
    return {
      blocker: 'invalid-delta',
      canSearch: false,
      primaryLabel: 'Find LEAPS',
      primaryHref: null,
      severity: 'warning',
      title: 'Fix exploratory delta',
      message: 'Optional min delta must be blank or a number between 0 and 1 (for example 0.65).',
      nextStep: 'Clear the field or enter a valid value, then try again.',
    };
  }

  if (input.portfolioView === 'demo') {
    if (!isDemoOnlyTicker(ticker)) {
      return {
        blocker: 'demo-mode-real-ticker',
        canSearch: false,
        primaryLabel: 'Find LEAPS',
        primaryHref: '/settings',
        severity: 'warning',
        title: 'Demo mode only searches DEMO',
        message: `“${ticker}” needs Authenticated brokerage view with live search enabled. Demo mode never shows synthetic chains labeled as real issuers.`,
        nextStep: 'Settings → Portfolio view → Authenticated brokerage account (sign-in required), or search DEMO while staying in demo mode.',
      };
    }
    return {
      blocker: 'ready-demo',
      canSearch: true,
      primaryLabel: 'Find LEAPS',
      primaryHref: null,
      severity: 'success',
      title: 'Ready to search DEMO',
      message: 'This run uses the labeled fictional DEMO chain — not live market prices.',
      nextStep: 'Click Find LEAPS to evaluate DEMO long-dated calls against your strategy.',
    };
  }

  // Brokerage portfolio view
  if (!input.finderLiveScanInstallAllowed) {
    return {
      blocker: 'live-install-disabled',
      canSearch: false,
      primaryLabel: 'Find LEAPS',
      primaryHref: null,
      severity: 'warning',
      title: 'Live search not authorized for this installation',
      message:
        'This deployment has FINDER_LIVE_SCAN=false. That installation-level permission must be set to true once (for example in docker-compose), then restart the app. In-app toggles cannot bypass it.',
      nextStep: 'After FINDER_LIVE_SCAN=true is set and the process restarts, enable on-demand searches in Settings.',
    };
  }

  if (!input.finderOnDemandSearchEnabled) {
    return {
      blocker: 'live-owner-disabled',
      canSearch: false,
      primaryLabel: 'Find LEAPS',
      primaryHref: '/settings',
      severity: 'warning',
      title: 'Enable on-demand searches',
      message: 'Owner on-demand LEAPS search is still off.',
      nextStep: 'Open Settings and turn on “On-demand LEAPS market searches”, then return here.',
    };
  }

  if (!input.brokerageLiveConfigured) {
    return {
      blocker: 'brokerage-unavailable',
      canSearch: false,
      primaryLabel: 'Find LEAPS',
      primaryHref: '/broker',
      severity: 'warning',
      title: 'Brokerage market data is not configured',
      message:
        'Live LEAPS discovery needs read-only brokerage credentials and live access enabled. A “no request since startup” banner means no successful call yet — it is not proof that credentials are invalid.',
      nextStep: 'Open Broker & Data to confirm secrets and connection, then retry Find LEAPS.',
    };
  }

  return {
    blocker: 'ready-live',
    canSearch: true,
    primaryLabel: 'Find LEAPS',
    primaryHref: null,
    severity: 'success',
    title: input.brokerageConnectedThisProcess ? 'Ready to search live chains' : 'Ready to search (first request will connect)',
    message: input.brokerageConnectedThisProcess
      ? 'Read-only nested option-chain requests are authorized for this session.'
      : 'No successful brokerage request has run since startup yet. The first Find LEAPS call will attempt a read-only connection — that is expected, not a credential failure by itself.',
    nextStep: `Click Find LEAPS to evaluate ${ticker} long-dated calls against your strategy.`,
  };
}
