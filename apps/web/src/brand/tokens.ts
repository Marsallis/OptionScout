/** Central OptionScout visual tokens. Components should use the MUI theme or these names. */
export const brand = {
  color: {
    background: '#081426',
    surface: '#101F35',
    surfaceHover: '#152A43',
    border: '#2D455E',
    text: '#F8FAFC',
    muted: '#9CB5D0',
    emerald: '#12D9AF',
    cyan: '#2BCBFB',
    positive: '#29D99E',
    warning: '#F6B64E',
    negative: '#FA6970',
    onPrimary: '#041924',
    focus: '#75DBFF',
  },
  font: {
    heading: '"Space Grotesk", "Inter", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  radius: {
    control: 11,
    card: 15,
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
    lift: '0 8px 24px rgba(18, 217, 175, 0.18)',
    card: '0 12px 28px rgba(0, 0, 0, 0.22)',
  },
} as const;
