import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BrokerOverview, Dashboard, SessionView, SettingsUpdate, SettingsView } from '@optionscout/shared';
import { fetchBroker, fetchDashboard, fetchSession, fetchSettings, login, logout, saveSettings, selectBrokerAccount, syncBroker } from '../api/client';

interface AppStateValue {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  dashboard: Dashboard | null;
  broker: BrokerOverview | null;
  settings: SettingsView | null;
  session: SessionView | null;
  savePreferences: (update: SettingsUpdate) => Promise<void>;
  signIn: (passphrase: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: (request: { transactions?: { mode: 'recent' | 'backfill'; startDate?: string } }) => Promise<BrokerOverview>;
  chooseAccount: (accountId: string) => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStateValue['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [broker, setBroker] = useState<BrokerOverview | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDashboard(), fetchBroker(), fetchSettings(), fetchSession()])
      .then(([nextDashboard, nextBroker, nextSettings, nextSession]) => {
        if (cancelled) return;
        setDashboard(nextDashboard);
        setBroker(nextBroker);
        setSettings(nextSettings);
        setSession(nextSession);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setError('The local API did not return the demo dashboard.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      status,
      error,
      dashboard,
      broker,
      settings,
      session,
      async savePreferences(update) {
        const saved = await saveSettings(update);
        setSettings(saved);
        const nextBroker = await fetchBroker();
        setBroker(nextBroker);
      },
      async signIn(passphrase) {
        const nextSession = await login(passphrase);
        setSession(nextSession);
        setBroker(await fetchBroker());
      },
      async signOut() {
        const nextSession = await logout();
        setSession(nextSession);
        setBroker(await fetchBroker());
      },
      async syncNow(request) {
        const next = await syncBroker(request);
        setBroker(next);
        return next;
      },
      async chooseAccount(accountId) {
        setBroker(await selectBrokerAccount(accountId));
      },
    }),
    [status, error, dashboard, broker, settings, session],
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
