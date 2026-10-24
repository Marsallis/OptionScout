import { createTheme, type PaletteMode } from '@mui/material/styles';
import { brand, palettes } from './brand/tokens';

const { font, motion, radius } = brand;

export function createAppTheme(mode: PaletteMode) {
  const color = palettes[mode];
  const dark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: { main: color.emerald, contrastText: color.onPrimary },
      secondary: { main: color.cyan, contrastText: dark ? color.onPrimary : '#FFFFFF' },
      background: {
        default: color.background,
        paper: color.surface,
      },
      text: {
        primary: color.text,
        secondary: color.muted,
      },
      success: { main: color.positive },
      warning: { main: color.warning },
      error: { main: color.negative },
      divider: color.border,
      action: {
        hover: dark ? 'rgba(232, 238, 246, 0.06)' : 'rgba(18, 32, 51, 0.04)',
      },
    },
    typography: {
      fontFamily: font.body,
      fontSize: 15,
      h1: { fontFamily: font.heading, fontWeight: 700, fontSize: '2rem', letterSpacing: '-0.04em' },
      h2: { fontFamily: font.heading, fontWeight: 700, fontSize: '1.75rem', letterSpacing: '-0.03em' },
      h3: { fontFamily: font.heading, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.03em' },
      h4: { fontFamily: font.heading, fontWeight: 700, fontSize: '1.85rem', letterSpacing: '-0.03em', lineHeight: 1.15 },
      h5: { fontFamily: font.heading, fontWeight: 650, fontSize: '1.35rem', letterSpacing: '-0.02em' },
      h6: { fontFamily: font.heading, fontWeight: 650, fontSize: '1.05rem' },
      subtitle1: { fontFamily: font.heading, fontWeight: 650, fontSize: '1rem' },
      body1: { fontSize: '0.95rem', lineHeight: 1.55 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 700, fontFamily: font.body, fontSize: '0.92rem' },
      caption: { fontSize: '0.8rem' },
      overline: { letterSpacing: '0.08em', fontWeight: 700 },
    },
    shape: { borderRadius: radius.control },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            '--os-font-heading': font.heading,
            '--os-font-body': font.body,
            '--os-font-mono': font.mono,
            '--os-ease': motion.ease,
            '--os-positive': color.positive,
            '--os-warning': color.warning,
            '--os-negative': color.negative,
            backgroundColor: color.background,
            backgroundImage: color.hero,
            backgroundAttachment: 'fixed',
            fontVariantNumeric: 'tabular-nums',
          },
          '@keyframes os-page-enter': {
            from: { opacity: 0, transform: 'translateY(6px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          '@keyframes os-scan': {
            '0%': { transform: 'translateY(6px)', opacity: 0.15 },
            '50%': { opacity: 0.7 },
            '100%': { transform: 'translateY(-6px)', opacity: 0.15 },
          },
          '@keyframes os-toast': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          '.os-page': {
            animation: `os-page-enter ${motion.page} ${motion.ease} both`,
          },
          '.os-mark--live .os-scan': {
            opacity: 0.85,
            animation: 'os-scan 1.3s ease-in-out infinite',
          },
          '.os-stock-row': {
            borderLeft: '3px solid transparent',
            transition: `background-color ${motion.fast} ${motion.ease}, border-color ${motion.fast} ${motion.ease}`,
          },
          '.os-stock-row[data-selected="true"]': {
            backgroundColor: dark ? 'rgba(45, 212, 191, 0.12)' : 'rgba(15, 118, 110, 0.08)',
            borderLeftColor: color.emerald,
          },
          '.os-result-card': {
            transition: `transform ${motion.medium} ${motion.ease}, border-color ${motion.medium} ${motion.ease}, box-shadow ${motion.medium} ${motion.ease}`,
          },
          '.os-result-card:hover': {
            transform: 'translateY(-2px)',
            borderColor: color.emerald,
            boxShadow: dark ? '0 12px 28px rgba(0, 0, 0, 0.28)' : brand.shadow.card,
          },
          '.os-result-card[data-selected="true"]': {
            borderColor: color.cyan,
            boxShadow: `inset 0 0 0 1px ${color.cyan}`,
          },
          '@media (prefers-reduced-motion: reduce)': {
            '.os-page, .os-mark--live .os-scan': { animation: 'none !important' },
            '.os-stock-row, .os-result-card, .MuiButton-root': { transition: 'none !important' },
            '.os-result-card:hover, .MuiButton-root:hover, .MuiButton-root:active': { transform: 'none !important' },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${color.border}`,
            borderRadius: radius.card,
            boxShadow: dark ? 'none' : '0 1px 2px rgba(18, 32, 51, 0.04)',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: radius.control,
            transition: `transform ${motion.press} ${motion.ease}, box-shadow ${motion.medium} ${motion.ease}, background-color ${motion.fast} ${motion.ease}, border-color ${motion.fast} ${motion.ease}`,
            '&:focus-visible': {
              outline: `3px solid ${color.focus}`,
              outlineOffset: 3,
            },
            '&.Mui-disabled': {
              transform: 'none',
              boxShadow: 'none',
            },
          },
          containedPrimary: {
            color: color.onPrimary,
            backgroundColor: color.emerald,
            boxShadow: 'none',
            '&:hover': {
              backgroundColor: color.emerald,
              transform: 'translateY(-1px)',
              boxShadow: brand.shadow.lift,
            },
            '&:active': {
              transform: 'translateY(0) scale(0.98)',
            },
          },
          outlined: {
            borderColor: color.border,
            color: color.text,
            backgroundColor: dark ? 'transparent' : color.surface,
            '&:hover': {
              borderColor: color.emerald,
              backgroundColor: color.surfaceHover,
            },
          },
          containedError: {
            boxShadow: 'none',
            '&:hover': { transform: 'translateY(-1px)' },
            '&:active': { transform: 'scale(0.98)' },
          },
          containedWarning: {
            boxShadow: 'none',
            '&:hover': { transform: 'translateY(-1px)' },
            '&:active': { transform: 'scale(0.98)' },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            '&:focus-visible': {
              outline: `3px solid ${color.focus}`,
              outlineOffset: 2,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 650,
            borderColor: color.border,
            '&.Mui-selected': {
              backgroundColor: dark ? 'rgba(45, 212, 191, 0.16)' : 'rgba(15, 118, 110, 0.12)',
              color: dark ? '#D7FFF8' : '#0F766E',
              borderColor: color.emerald,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: dark ? '#0E1726' : '#FFFFFF',
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: color.cyan },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: color.emerald },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: color.border,
            fontVariantNumeric: 'tabular-nums',
          },
          head: {
            color: color.muted,
            fontSize: '0.75rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { alignItems: 'flex-start' },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { backgroundImage: 'none' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 650 },
        },
      },
    },
  });
}

export const theme = createAppTheme('dark');
