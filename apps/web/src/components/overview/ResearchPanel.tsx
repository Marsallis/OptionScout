import { useEffect, useState } from 'react';
import type { ResearchSessionSummary } from '@optionscout/shared';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { fetchFinderBookmarks, fetchResearchSessions } from '../../api/client';
import { useAppState } from '../../state/AppState';

export function ResearchPanel() {
  const { session } = useAppState();
  const [latest, setLatest] = useState<ResearchSessionSummary | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!session?.authenticated) return;
    let cancelled = false;
    void Promise.allSettled([fetchResearchSessions('discover', 5), fetchFinderBookmarks()])
      .then((results) => {
        if (cancelled) return;
        const sessions = results[0].status === 'fulfilled' ? results[0].value.sessions : [];
        const bookmarks = results[1].status === 'fulfilled' ? results[1].value.bookmarks.length : 0;
        setLatest(sessions[0] ?? null);
        setSavedCount(bookmarks);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.authenticated]);

  return (
    <Stack spacing={1.25} component="section" aria-label="My LEAPS research">
      <Typography variant="h5" component="h2" sx={{ fontSize: { xs: '1.25rem', md: '1.5rem' } }}>
        My LEAPS Research
      </Typography>
      <Paper sx={{ p: 2.25 }}>
        {!ready ? <Typography variant="body1">Loading saved research.</Typography> : null}
        {ready && !latest ? (
          <Typography variant="body1">
            No saved stock research yet. Explore Stocks keeps the results on this computer and does not start a search by itself.
          </Typography>
        ) : null}
        {latest ? (
          <Stack spacing={0.75}>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{latest.universeLabel}</Typography>
            <Typography variant="body2" color="text.secondary">
              {latest.companiesProcessed} of {latest.companiesInUniverse} companies examined · {latest.contractsEvaluated} contracts evaluated · {latest.status}.
              Saved matches are from {new Date(latest.updatedAt).toLocaleString()} and are not verified current-market opportunities.
            </Typography>
            {latest.companiesRemaining > 0 || latest.canScanMoreContracts ? (
              <Typography variant="body2">Additional companies or contracts in this session may still be unexamined.</Typography>
            ) : null}
            <Typography variant="body2">{savedCount} saved candidate{savedCount === 1 ? '' : 's'}.</Typography>
            <Button component={RouterLink} to={`/discover?session=${encodeURIComponent(latest.id)}`} variant="contained" sx={{ alignSelf: 'flex-start', mt: 1 }}>
              View Saved Research
            </Button>
          </Stack>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Button component={RouterLink} to="/discover" size="small">Explore Stocks</Button>
          <Button component={RouterLink} to="/leaps" size="small">Find One Stock</Button>
          <Button component={RouterLink} to="/strategies" size="small">My Investing Rules</Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
