import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ResearchSessionSummary } from '@optionscout/shared';

export function RecentSearchesPanel({
  title = 'Recent Searches',
  sessions,
  activeId,
  onContinueLast,
  onViewSaved,
  onStartFresh,
  onDelete,
  onOpen,
}: {
  title?: string;
  sessions: ResearchSessionSummary[];
  activeId?: string | null;
  onContinueLast: () => void;
  onViewSaved: (id: string) => void;
  onStartFresh: () => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const latest = sessions[0] ?? null;

  return (
    <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
          <Typography variant="h6">{title}</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" variant="contained" disabled={!latest} onClick={onContinueLast}>
              View Previous Results
            </Button>
            <Button size="small" variant="outlined" onClick={onStartFresh}>
              Clear open results
            </Button>
          </Stack>
        </Stack>

        <Alert severity="info" icon={false}>
          View Previous Results opens saved observations. It does not request market data and does not start a new search.
          Continue Search and Scan More Contracts are separate actions on the open session.
        </Alert>

        {latest ? (
          <Typography variant="body2" color="text.secondary">
            Latest: {latest.universeLabel} · strategy rev {latest.profileRevision} ·{' '}
            {latest.contractsEvaluated} contracts evaluated · {latest.companiesProcessed}/
            {latest.companiesInUniverse} companies processed · {latest.status}
            {activeId === latest.id ? ' · open now' : ''}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No saved research sessions yet.
          </Typography>
        )}

        {sessions.length > 0 ? (
          <Stack spacing={0.75}>
            {sessions.slice(0, 8).map((row) => (
              <Stack
                key={row.id}
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', py: 0.5 }}
              >
                <Typography variant="body2" sx={{ minWidth: 0 }}>
                  <strong>{row.universeLabel}</strong>
                  {' · '}
                  {new Date(row.updatedAt).toLocaleString()}
                  {' · '}
                  {row.contractsEvaluated} contracts
                  {' · '}
                  {row.nextActionHint}
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
                  <Button size="small" onClick={() => onViewSaved(row.id)}>
                    View Saved Results
                  </Button>
                  <Button size="small" onClick={() => onOpen(row.id)}>
                    Open
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => {
                      if (window.confirm('Delete this saved research session? This cannot be undone.')) {
                        onDelete(row.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
