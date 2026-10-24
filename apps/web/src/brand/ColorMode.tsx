import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { COLORWAY_CHOICES, type ColorwayId } from './tokens';

export type ColorMode = 'light' | 'dark';
export type { ColorwayId };

const STORAGE_KEY = 'optionscout.colorMode';
const COLORWAY_KEY = 'optionscout.colorway';

interface ColorModeValue {
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
  toggle: () => void;
  colorway: ColorwayId;
  setColorway: (colorway: ColorwayId) => void;
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

function readStoredColorway(): ColorwayId {
  try {
    const stored = localStorage.getItem(COLORWAY_KEY);
    if (COLORWAY_CHOICES.some((choice) => choice.id === stored)) return stored as ColorwayId;
  } catch {
    // A missing preference falls back to the default colorway.
  }
  return 'default';
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(readStoredMode);
  const [colorway, setColorway] = useState<ColorwayId>(readStoredColorway);

  useEffect(() => {
    document.documentElement.dataset.colorMode = mode;
    document.documentElement.dataset.colorway = colorway;
    document.documentElement.style.colorScheme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
      localStorage.setItem(COLORWAY_KEY, colorway);
    } catch {
      // Preference stays for this visit when storage is blocked.
    }
  }, [mode, colorway]);

  const value = useMemo<ColorModeValue>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode((current) => (current === 'dark' ? 'light' : 'dark')),
      colorway,
      setColorway,
    }),
    [mode, colorway],
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
