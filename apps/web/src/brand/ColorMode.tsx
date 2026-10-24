import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'optionscout.colorMode';

interface ColorModeValue {
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeValue | null>(null);

function readStoredMode(): ColorMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private browsing can reject storage. The desk still opens in dark mode.
  }
  return 'dark';
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(readStoredMode);

  useEffect(() => {
    document.documentElement.dataset.colorMode = mode;
    document.documentElement.style.colorScheme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Preference stays for this visit when storage is blocked.
    }
  }, [mode]);

  const value = useMemo<ColorModeValue>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [mode],
  );

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode(): ColorModeValue {
  const value = useContext(ColorModeContext);
  if (!value) {
    throw new Error('useColorMode must be used inside ColorModeProvider.');
  }
  return value;
}
