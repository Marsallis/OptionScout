import { useEffect, useMemo, useState } from 'react';
import type { FinderCandidate, ResearchSessionSummary } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { fetchLatestResearchSession, fetchResearchSessions } from '../api/client';
import { DemoChip } from '../components/DemoChip';
import { useAppState } from '../state/AppState';

type FeedFilter = 'all' | 'searches' | 'matches' | 'notes';

export function ResearchFeedPage() {
  const { dashboard } = useAppState();
  const [sessions, setSessions] = useState<ResearchSessionSummary[]>([]);
  const [matches, setMatches] = useState<FinderCandidate[]>([]);
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FeedFilter>('all');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchResearchSessions('finder', 20).catch(() => null),
      fetchResearchSessions('discover', 20).catch(() => null),
      fetchLatestResearchSession('finder').catch(() => null),
    ]).then(([finder, discover, latest]) => {
      if (cancelled) return;
      if (!finder && !discover) {
        setSessionNote('Saved searches appear after a DEMO search. Faircloth OS is off and this feed does not connect anywhere else.');
      }
      setSessions([...(finder?.sessions ?? []), ...(discover?.sessions ?? [])]);
      if (latest && latest.kind === 'finder') {
        setMatches(latest.result.candidates.filter((candidate) => candidate.outcome === 'exact' || candidate.outcome === 'near'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const needle = query.trim().toUpperCase();
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !needle || `${session.universeLabel} ${session.profileName} ${session.scanType}`.toUpperCase().includes(needle)),
    [needle, sessions],
  );
  const visibleMatches = useMemo(
    () => matches.filter((match) => !needle || match.underlying.toUpperCase().includes(needle) || match.occSymbol.toUpperCase().includes(needle)),
    [matches, needle],
  );
  const notes = useMemo(
    () => (dashboard?.research ?? []).filter((item) => !needle || item.underlying.includes(needle) || item.title.toUpperCase().includes(needle)),
    [dashboard?.research, needle],
  );

  return (
    <Stack spacing={2.5} data-testid="research-feed">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between' }}>
        <div>
          <Typography variant="h4" component="h1">Research Feed</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            Saved searches and notable simulated matches against your rules. Faircloth OS integration stays off. No external connection is made from this page.
          </Typography>
        </div>
        <DemoChip />
      </Stack>
      <Alert severity="info">Faircloth OS is off. Rows below come from this computer&apos;s simulated book and saved research sessions.</Alert>
      {sessionNote ? <Alert severity="info">{sessionNote}</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField label="Filter by ticker or name" value={query} onChange={(event) => setQuery(event.target.value)} fullWidth />
        <TextField select label="Show" value={filter} onChange={(event) => setFilter(event.target.value as FeedFilter)} sx={{ minWidth: { sm: 220 } }}>
          <MenuItem value="all">Everything</MenuItem>
          <MenuItem value="searches">Saved searches</MenuItem>
          <MenuItem value="matches">Notable matches</MenuItem>
          <MenuItem value="notes">Illustrative notes</MenuItem>
        </TextField>
      </Stack>
      {filter === 'all' || filter === 'searches' ? (
        <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="h6">Saved searches</Typography>
          {visibleSessions.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No saved search matches this filter.</Typography> : (
            <Stack spacing={1.25} sx={{ mt: 1.5 }}>
              {visibleSessions.map((session) => (
                <Stack key={session.id} spacing={0.25}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>{session.universeLabel}</Typography>
                    <Chip size="small" label={session.scanType} />
                    <Chip size="small" variant="outlined" label={session.status} />
                    {session.simulated ? <Chip size="small" label="Simulated" /> : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{session.profileName} · revision {session.profileRevision} · {session.contractsEvaluated} contracts · {session.updatedAt.slice(0, 10)}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
      ) : null}
      {filter === 'all' || filter === 'matches' ? (
        <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="h6">Notable matches</Typography>
          <Typography variant="body2" color="text.secondary">Best and near matches from the latest saved Find One Stock session.</Typography>
          {visibleMatches.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No notable matches yet. Search DEMO on Find One Stock.</Typography> : (
            <Stack spacing={1} sx={{ mt: 1.5 }}>
              {visibleMatches.slice(0, 12).map((match) => (
                <Typography key={match.occSymbol} variant="body2">{match.underlying} {match.expiration} {match.strike} call · {match.outcome} · simulated</Typography>
              ))}
            </Stack>
          )}
        </Paper>
      ) : null}
      {filter === 'all' || filter === 'notes' ? (
        <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="h6">Illustrative notes</Typography>
          <Typography variant="body2" color="text.secondary">These demo-book notes are not rule scores and not live candidates.</Typography>
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {notes.map((item) => (
              <Typography key={item.id} variant="body2">{item.title}. {item.summary}</Typography>
            ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
