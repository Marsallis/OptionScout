import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ExperienceMode = 'beginner' | 'pro';

const STORAGE_KEY = 'optionscout.experience';

interface ExperienceModeValue {
  mode: ExperienceMode;
  setMode: (mode: ExperienceMode) => void;
}

const ExperienceModeContext = createContext<ExperienceModeValue | null>(null);

function readStoredMode(): ExperienceMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'beginner' || stored === 'pro') return stored;
  } catch {
    // The desk opens in the beginner view when storage is blocked.
  }
  return 'beginner';
}

export function ExperienceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ExperienceMode>(readStoredMode);

  useEffect(() => {
    document.documentElement.dataset.experience = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // The choice stays for this visit.
    }
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return <ExperienceModeContext.Provider value={value}>{children}</ExperienceModeContext.Provider>;
}

export function useExperienceMode(): ExperienceModeValue {
  const value = useContext(ExperienceModeContext);
  if (!value) {
    throw new Error('useExperienceMode must be used inside ExperienceModeProvider.');
  }
  return value;
}
