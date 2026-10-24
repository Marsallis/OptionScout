/** Central OptionScout visual tokens. Components should use the MUI theme or these names. */

export interface BrandPalette {
  background: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  muted: string;
  emerald: string;
  cyan: string;
  positive: string;
  warning: string;
  negative: string;
  onPrimary: string;
  focus: string;
  hero: string;
}

export const palettes: Record<'light' | 'dark', BrandPalette> = {
  dark: {
    background: '#0B1220',
    surface: '#141C2B',
    surfaceHover: '#1C283C',
    border: '#2A3A52',
    text: '#E8EEF6',
    muted: '#93A4BC',
    emerald: '#2DD4BF',
    cyan: '#7DD3FC',
    positive: '#34D399',
    warning: '#F5B942',
    negative: '#F07178',
    onPrimary: '#04241F',
    focus: '#99F6E4',
    hero: 'linear-gradient(135deg, rgba(45, 212, 191, 0.16), rgba(125, 211, 252, 0.05) 42%, transparent 70%)',
  },
  light: {
    background: '#F4F7FB',
    surface: '#FFFFFF',
    surfaceHover: '#F8FBFD',
    border: '#D5DEE8',
    text: '#122033',
    muted: '#5C6D82',
    emerald: '#0F766E',
    cyan: '#0369A1',
    positive: '#047857',
    warning: '#B45309',
    negative: '#B42318',
    onPrimary: '#F8FFFD',
    focus: '#0F766E',
    hero: 'linear-gradient(135deg, rgba(15, 118, 110, 0.10), rgba(3, 105, 161, 0.05) 46%, transparent 72%)',
  },
};

export const brand = {
  color: palettes.dark,
  font: {
    heading: '"Space Grotesk", "Inter", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  radius: {
    control: 10,
    card: 16,
    nav: 10,
  },
  motion: {
    press: '120ms',
    fast: '160ms',
    medium: '180ms',
    page: '200ms',
    ease: 'cubic-bezier(.2, .8, .2, 1)',
  },
  shadow: {
    lift: '0 10px 24px rgba(15, 118, 110, 0.16)',
    card: '0 10px 28px rgba(15, 23, 42, 0.08)',
  },
} as const;
