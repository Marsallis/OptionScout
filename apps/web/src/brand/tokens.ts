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

export type ColorwayId = 'default' | 'emerald' | 'midnight' | 'ocean' | 'sunset';

export const COLORWAY_CHOICES: ReadonlyArray<{ id: ColorwayId; label: string; short: string }> = [
  { id: 'default', label: 'Default', short: 'Default' },
  { id: 'emerald', label: 'Emerald Growth', short: 'Emerald' },
  { id: 'midnight', label: 'Midnight Gold', short: 'Gold' },
  { id: 'ocean', label: 'Ocean Blue', short: 'Ocean' },
  { id: 'sunset', label: 'Sunset Copper', short: 'Copper' },
];

const darkBase = {
  positive: '#34D399',
  warning: '#F5B942',
  negative: '#F07178',
} as const;

const lightBase = {
  positive: '#047857',
  warning: '#B45309',
  negative: '#B42318',
} as const;

export const colorways: Record<ColorwayId, Record<'light' | 'dark', BrandPalette>> = {
  default: {
    dark: {
      background: '#0B1220',
      surface: '#141C2B',
      surfaceHover: '#1C283C',
      border: '#2A3A52',
      text: '#E8EEF6',
      muted: '#B7C4D6',
      emerald: '#2DD4BF',
      cyan: '#7DD3FC',
      ...darkBase,
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
      muted: '#3E5168',
      emerald: '#0F766E',
      cyan: '#0369A1',
      ...lightBase,
      onPrimary: '#F8FFFD',
      focus: '#0F766E',
      hero: 'linear-gradient(135deg, rgba(15, 118, 110, 0.10), rgba(3, 105, 161, 0.05) 46%, transparent 72%)',
    },
  },
  emerald: {
    dark: {
      background: '#071510',
      surface: '#10241C',
      surfaceHover: '#173226',
      border: '#2A4A3C',
      text: '#E7F6EF',
      muted: '#B7D4C6',
      emerald: '#3DDC97',
      cyan: '#8EE4C4',
      positive: '#4ADE80',
      warning: '#F5B942',
      negative: '#F07178',
      onPrimary: '#052116',
      focus: '#BBF7D0',
      hero: 'linear-gradient(135deg, rgba(61, 220, 151, 0.18), transparent 68%)',
    },
    light: {
      background: '#F3F8F4',
      surface: '#FFFFFF',
      surfaceHover: '#F7FBF8',
      border: '#C9DDD2',
      text: '#10281C',
      muted: '#3F5C4C',
      emerald: '#0B6B45',
      cyan: '#0F766E',
      ...lightBase,
      onPrimary: '#F4FFF8',
      focus: '#0B6B45',
      hero: 'linear-gradient(135deg, rgba(11, 107, 69, 0.12), transparent 70%)',
    },
  },
  midnight: {
    dark: {
      background: '#100E0A',
      surface: '#1C1812',
      surfaceHover: '#292318',
      border: '#433A2A',
      text: '#F6F0E4',
      muted: '#D4C4A8',
      emerald: '#E2B657',
      cyan: '#F0D48A',
      positive: '#86EFAC',
      warning: '#F5B942',
      negative: '#F0A0A0',
      onPrimary: '#1A1406',
      focus: '#FDE68A',
      hero: 'linear-gradient(135deg, rgba(226, 182, 87, 0.18), transparent 68%)',
    },
    light: {
      background: '#FBF6EC',
      surface: '#FFFCF6',
      surfaceHover: '#F8F1E2',
      border: '#E4D5B8',
      text: '#2A2416',
      muted: '#5C5344',
      emerald: '#8A5A12',
      cyan: '#6B4710',
      positive: '#047857',
      warning: '#92400E',
      negative: '#B42318',
      onPrimary: '#FFF8EA',
      focus: '#8A5A12',
      hero: 'linear-gradient(135deg, rgba(138, 90, 18, 0.12), transparent 70%)',
    },
  },
  ocean: {
    dark: {
      background: '#071018',
      surface: '#102033',
      surfaceHover: '#173049',
      border: '#2A4564',
      text: '#E7F1FA',
      muted: '#B7CBDE',
      emerald: '#7CC4FF',
      cyan: '#93C5FD',
      positive: '#34D399',
      warning: '#F5B942',
      negative: '#F07178',
      onPrimary: '#062033',
      focus: '#BFDBFE',
      hero: 'linear-gradient(135deg, rgba(124, 196, 255, 0.18), transparent 68%)',
    },
    light: {
      background: '#F4F8FC',
      surface: '#FFFFFF',
      surfaceHover: '#F5F9FC',
      border: '#D0DEEA',
      text: '#102033',
      muted: '#3E5670',
      emerald: '#0B4F8A',
      cyan: '#075985',
      ...lightBase,
      onPrimary: '#F5FAFF',
      focus: '#0B4F8A',
      hero: 'linear-gradient(135deg, rgba(11, 79, 138, 0.12), transparent 70%)',
    },
  },
  sunset: {
    dark: {
      background: '#140E0C',
      surface: '#241815',
      surfaceHover: '#33221C',
      border: '#4A332B',
      text: '#F8EFEA',
      muted: '#E0C2B4',
      emerald: '#F0A06A',
      cyan: '#F6C09A',
      positive: '#86EFAC',
      warning: '#F5B942',
      negative: '#F0A0A0',
      onPrimary: '#2A1208',
      focus: '#FECACA',
      hero: 'linear-gradient(135deg, rgba(240, 160, 106, 0.18), transparent 68%)',
    },
    light: {
      background: '#FBF6F3',
      surface: '#FFFFFF',
      surfaceHover: '#FBF7F4',
      border: '#E7D5CC',
      text: '#2C1812',
      muted: '#6A4638',
      emerald: '#9A3412',
      cyan: '#C2410C',
      positive: '#047857',
      warning: '#92400E',
      negative: '#B42318',
      onPrimary: '#FFF7F3',
      focus: '#9A3412',
      hero: 'linear-gradient(135deg, rgba(154, 52, 18, 0.12), transparent 70%)',
    },
  },
};

export const palettes = colorways.default;

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
