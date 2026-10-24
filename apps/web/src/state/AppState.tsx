import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BrokerOverview, Dashboard, SessionView, SettingsUpdate, SettingsView } from '@optionscout/shared';
import { fetchBroker, fetchDashboard, fetchSession, fetchSettings, login, logout, saveSettings, selectBrokerAccount, setupOwner, syncBroker } from '../api/client';

type SectionStatus = 'loading' | 'ready' | 'error';

interface AppStateValue {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  dashboardStatus: SectionStatus;
  brokerStatus: SectionStatus;
  settingsStatus: SectionStatus;
  sessionStatus: SectionStatus;
  dashboardError: string | null;
  brokerError: string | null;
  settingsError: string | null;
  sessionError: string | null;
  dashboard: Dashboard | null;
  broker: BrokerOverview | null;
  settings: SettingsView | null;
  session: SessionView | null;
  savePreferences: (update: SettingsUpdate) => Promise<void>;
  signIn: (passphrase: string) => Promise<void>;
  createPassphrase: (passphrase: string, confirm: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: (request: { transactions?: { mode: 'recent' | 'backfill'; startDate?: string } }) => Promise<BrokerOverview>;
  chooseAccount: (accountId: string) => Promise<void>;
  applyBroker: (next: BrokerOverview) => void;
  retryDashboard: () => void;
  retryBroker: () => void;
  retrySettings: () => void;
  retrySession: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [dashboardStatus, setDashboardStatus] = useState<SectionStatus>('loading');
  const [brokerStatus, setBrokerStatus] = useState<SectionStatus>('loading');
  const [settingsStatus, setSettingsStatus] = useState<SectionStatus>('loading');
  const [sessionStatus, setSessionStatus] = useState<SectionStatus>('loading');
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [brokerError, setBrokerError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [broker, setBroker] = useState<BrokerOverview | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [dashboardAttempt, setDashboardAttempt] = useState(0);
  const [brokerAttempt, setBrokerAttempt] = useState(0);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDashboardStatus('loading');
    setDashboardError(null);
    fetchDashboard()
      .then((next) => {
        if (cancelled) return;
        setDashboard(next);
        setDashboardStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setDashboard(null);
        setDashboardError(message(reason, 'The demo dashboard is unavailable.'));
        setDashboardStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardAttempt]);

  useEffect(() => {
    let cancelled = false;
    setBrokerStatus('loading');
    setBrokerError(null);
    fetchBroker()
      .then((next) => {
        if (cancelled) return;
        setBroker(next);
        setBrokerStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setBroker(null);
        setBrokerError(message(reason, 'Broker status is unavailable.'));
        setBrokerStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [brokerAttempt]);

  useEffect(() => {
    let cancelled = false;
    setSettingsStatus('loading');
    setSettingsError(null);
    fetchSettings()
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setSettingsStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setSettings(null);
        setSettingsError(message(reason, 'Settings are unavailable.'));
        setSettingsStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [settingsAttempt]);

  useEffect(() => {
    let cancelled = false;
    setSessionStatus('loading');
    setSessionError(null);
    fetchSession()
      .then((next) => {
        if (cancelled) return;
        setSession(next);
        setSessionStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setSession(null);
        setSessionError(message(reason, 'The local session check failed.'));
        setSessionStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionAttempt]);

  const retryDashboard = useCallback(() => setDashboardAttempt((value) => value + 1), []);
  const retryBroker = useCallback(() => setBrokerAttempt((value) => value + 1), []);
  const retrySettings = useCallback(() => setSettingsAttempt((value) => value + 1), []);
  const retrySession = useCallback(() => setSessionAttempt((value) => value + 1), []);

  const status: AppStateValue['status'] = sessionStatus === 'loading' ? 'loading' : sessionStatus === 'error' ? 'error' : 'ready';

  const value = useMemo<AppStateValue>(
    () => ({
      status,
      error: sessionError,
      dashboardStatus,
      brokerStatus,
      settingsStatus,
      sessionStatus,
      dashboardError,
      brokerError,
      settingsError,
      sessionError,
      dashboard,
      broker,
      settings,
      session,
      async savePreferences(update) {
        const saved = await saveSettings(update);
        setSettings(saved);
        setSettingsStatus('ready');
        setSettingsError(null);
        try {
          setBroker(await fetchBroker());
          setBrokerStatus('ready');
          setBrokerError(null);
        } catch (reason) {
          setBroker(null);
          setBrokerError(message(reason, 'Broker status is unavailable.'));
          setBrokerStatus('error');
        }
      },
      async createPassphrase(passphrase, confirm) {
        const nextSession = await setupOwner(passphrase, confirm);
        setSession(nextSession);
        setSessionStatus('ready');
        setSessionError(null);
      },
      async signIn(passphrase) {
        const nextSession = await login(passphrase);
        setSession(nextSession);
        setSessionStatus('ready');
        setSessionError(null);
        setBroker(await fetchBroker());
        setBrokerStatus('ready');
      },
      async signOut() {
        const nextSession = await logout();
        setSession(nextSession);
        setSessionStatus('ready');
        setBroker(await fetchBroker());
        setBrokerStatus('ready');
      },
      async syncNow(request) {
        const next = await syncBroker(request);
        setBroker(next);
        setBrokerStatus('ready');
        return next;
      },
      async chooseAccount(accountId) {
        setBroker(await selectBrokerAccount(accountId));
        setBrokerStatus('ready');
      },
      applyBroker(next) {
        setBroker(next);
        setBrokerStatus('ready');
      },
      retryDashboard,
      retryBroker,
      retrySettings,
      retrySession,
    }),
    [
      status,
      sessionError,
      dashboardStatus,
      brokerStatus,
      settingsStatus,
      sessionStatus,
      dashboardError,
      brokerError,
      settingsError,
      dashboard,
      broker,
      settings,
      session,
      retryDashboard,
      retryBroker,
      retrySettings,
      retrySession,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error('useAppState must be used inside AppStateProvider.');
  }
  return value;
}
