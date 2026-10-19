import { createTheme } from '@mui/material/styles';
import { brand } from './brand/tokens';

const { color, font, motion, radius, shadow } = brand;

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: color.emerald, contrastText: color.onPrimary },
    secondary: { main: color.cyan, contrastText: color.onPrimary },
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
    body1: { fontSize: '0.95rem', lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', lineHeight: 1.45 },
    button: { textTransform: 'none', fontWeight: 700, fontFamily: font.body, fontSize: '0.92rem' },
    caption: { fontSize: '0.8rem' },
  },
  shape: { borderRadius: radius.control },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '@font-face': [
          {
            fontFamily: 'Inter',
            fontStyle: 'normal',
            fontWeight: '100 900',
            fontDisplay: 'swap',
            src: 'url(/fonts/inter-latin.woff2) format("woff2")',
          },
          {
            fontFamily: 'Space Grotesk',
            fontStyle: 'normal',
            fontWeight: '100 900',
            fontDisplay: 'swap',
            src: 'url(/fonts/space-grotesk-latin.woff2) format("woff2")',
          },
          {
            fontFamily: 'IBM Plex Mono',
            fontStyle: 'normal',
            fontWeight: 500,
            fontDisplay: 'swap',
            src: 'url(/fonts/ibm-plex-mono-500.woff2) format("woff2")',
          },
          {
            fontFamily: 'IBM Plex Mono',
            fontStyle: 'normal',
            fontWeight: 600,
            fontDisplay: 'swap',
            src: 'url(/fonts/ibm-plex-mono-600.woff2) format("woff2")',
          },
        ],
        ':root': {
          '--os-font-heading': font.heading,
          '--os-font-body': font.body,
          '--os-font-mono': font.mono,
          '--os-ease': motion.ease,
          '--os-positive': color.positive,
          '--os-warning': color.warning,
          '--os-negative': color.negative,
        },
        body: {
          backgroundColor: color.background,
          backgroundImage: 'radial-gradient(900px 420px at 0% -10%, rgba(18, 217, 175, 0.10), transparent 55%)',
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
          backgroundColor: 'rgba(18, 217, 175, 0.10)',
          borderLeftColor: color.emerald,
        },
        '.os-result-card': {
          transition: `transform ${motion.medium} ${motion.ease}, border-color ${motion.medium} ${motion.ease}, box-shadow ${motion.medium} ${motion.ease}`,
        },
        '.os-result-card:hover': {
          transform: 'translateY(-2px)',
          borderColor: '#1BBDAF',
          boxShadow: shadow.card,
        },
        '.os-result-card[data-selected="true"]': {
          borderColor: color.cyan,
          boxShadow: 'inset 0 0 0 1px rgba(43, 203, 251, 0.45)',
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
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: radius.control,
          transition: `transform ${motion.press} ${motion.ease}, box-shadow ${motion.medium} ${motion.ease}, filter ${motion.medium} ${motion.ease}, background-color ${motion.fast} ${motion.ease}, border-color ${motion.fast} ${motion.ease}`,
          '&:focus-visible': {
            outline: `3px solid ${color.focus}`,
            outlineOffset: 3,
          },
          '&.Mui-disabled': {
            transform: 'none',
            boxShadow: 'none',
            filter: 'none',
          },
        },
        containedPrimary: {
          color: color.onPrimary,
          background: 'linear-gradient(110deg, #12D9AF, #23CDDF)',
          boxShadow: 'none',
          '&:hover': {
            background: 'linear-gradient(110deg, #12D9AF, #23CDDF)',
            transform: 'translateY(-2px)',
            filter: 'brightness(1.06)',
            boxShadow: shadow.lift,
          },
          '&:active': {
            transform: 'translateY(0) scale(0.98)',
            filter: 'brightness(0.96)',
          },
        },
        outlined: {
          borderColor: '#238BA2',
          color: '#D4F7FD',
          backgroundColor: '#0E2238',
          '&:hover': {
            borderColor: color.cyan,
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
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#0C1B2E',
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: color.cyan },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: color.emerald },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(45, 69, 94, 0.7)',
          fontVariantNumeric: 'tabular-nums',
        },
        head: {
          color: color.muted,
          fontSize: '0.78rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { alignItems: 'center' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { backgroundImage: 'none' },
      },
    },
  },
});
