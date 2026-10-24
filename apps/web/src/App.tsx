import { useMemo } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { ColorModeProvider, useColorMode } from './brand/ColorMode';
import { AppShell } from './layout/AppShell';
import { AppStateProvider } from './state/AppState';
import { ResearchWorkspaceProvider } from './state/ResearchWorkspace';
import { createAppTheme } from './theme';

function ThemedApp() {
  const { mode } = useColorMode();
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppStateProvider>
        <ResearchWorkspaceProvider>
          <AppShell />
        </ResearchWorkspaceProvider>
      </AppStateProvider>
    </ThemeProvider>
  );
}

export function App() {
  return (
    <ColorModeProvider>
      <ThemedApp />
    </ColorModeProvider>
  );
}
