import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#2EC4B6' },
    secondary: { main: '#7DCEA0' },
    background: {
      default: '#07101C',
      paper: '#101C30',
    },
    text: {
      primary: '#E8EEF8',
      secondary: '#93A4BE',
    },
    success: { main: '#3DDC97' },
    warning: { main: '#E6B450' },
    error: { main: '#F07178' },
    divider: 'rgba(146, 176, 210, 0.16)',
  },
  typography: {
    fontFamily: '"Segoe UI", "Helvetica Neue", system-ui, sans-serif',
    h4: { fontWeight: 650, letterSpacing: '-0.03em' },
    h5: { fontWeight: 650, letterSpacing: '-0.02em' },
    h6: { fontWeight: 650 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#07101C',
          backgroundImage:
            'radial-gradient(900px 420px at 0% -10%, rgba(46, 196, 182, 0.09), transparent 55%)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(146, 176, 210, 0.14)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(146, 176, 210, 0.12)',
        },
        head: {
          color: '#93A4BE',
          fontSize: '0.75rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
      },
    },
  },
});
