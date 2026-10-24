import { useMemo } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { ColorModeProvider, useColorMode } from './brand/ColorMode';
import { ExperienceModeProvider } from './brand/ExperienceMode';
import { AppShell } from './layout/AppShell';
import { AppStateProvider } from './state/AppState';
import { ResearchWorkspaceProvider } from './state/ResearchWorkspace';
import { createAppTheme } from './theme';

function ThemedApp() {
  const { mode, colorway } = useColorMode();
  const theme = useMemo(() => createAppTheme(mode, colorway), [mode, colorway]);

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
      <ExperienceModeProvider>
        <ThemedApp />
      </ExperienceModeProvider>
    </ColorModeProvider>
  );
}
