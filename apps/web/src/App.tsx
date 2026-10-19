import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { AppShell } from './layout/AppShell';
import { AppStateProvider } from './state/AppState';
import { ResearchWorkspaceProvider } from './state/ResearchWorkspace';
import { theme } from './theme';

export function App() {
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
