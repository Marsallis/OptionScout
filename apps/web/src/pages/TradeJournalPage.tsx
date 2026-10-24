import { useEffect, useState } from 'react';
import type { TradeJournalEntry, TradeJournalWrite } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { createTradeJournalEntry, deleteTradeJournalEntry, fetchTradeJournal, updateTradeJournalEntry } from '../api/client';
import { DemoChip } from '../components/DemoChip';
import { formatSignedUsd, formatUsd } from '../lib/format';

const emptyForm = {
  entryDate: '2026-10-15',
  ticker: 'DEMO',
  strategy: 'PMCC',
  entryPremium: '18.00',
  exitPremium: '',
  notes: '',
  tags: '',
  outcome: 'open' as TradeJournalWrite['outcome'],
};

function toWrite(form: typeof emptyForm): TradeJournalWrite {
  return {
    entryDate: form.entryDate,
    ticker: form.ticker.trim().toUpperCase(),
    strategy: form.strategy.trim(),
    entryPremium: Number(form.entryPremium).toFixed(2),
    exitPremium: form.exitPremium.trim() === '' ? null : Number(form.exitPremium).toFixed(2),
    notes: form.notes,
    tags: form.tags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    outcome: form.outcome,
  };
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function TradeJournalPage() {
  const [entries, setEntries] = useState<TradeJournalEntry[]>([]);
  const [summary, setSummary] = useState<{ count: number; wins: number; losses: number; winRate: string | null; totalEstimatedPnl: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    const listed = await fetchTradeJournal();
    setEntries(listed.entries);
    setSummary(listed.summary);
  }

  useEffect(() => {
    void reload().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'The journal did not load.'));
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const body = toWrite(form);
      if (editingId) await updateTradeJournalEntry(editingId, body);
      else await createTradeJournalEntry(body);
      setForm(emptyForm);
      setEditingId(null);
      await reload();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'The journal entry could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv(): void {
    const header = ['date', 'ticker', 'strategy', 'entry', 'exit', 'outcome', 'estimatedPnl', 'tags', 'notes'];
    const lines = entries.map((entry) => [
      entry.entryDate,
      entry.ticker,
      entry.strategy,
      entry.entryPremium,
      entry.exitPremium ?? '',
      entry.outcome,
      entry.estimatedPnl ?? '',
      entry.tags.join('|'),
      entry.notes,
    ].map(csvCell).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'optionscout-journal.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Stack spacing={2.5} data-testid="trade-journal">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between' }}>
        <div>
          <Typography variant="h4" component="h1">Trade Journal</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            Notes stay in the local database. Estimated P/L is (exit − entry) × 100 for one contract. This journal does not import fills and does not place orders.
          </Typography>
        </div>
        <DemoChip />
      </Stack>
      {notice ? <Alert severity="warning">{notice}</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Paper sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">Win rate</Typography>
          <Typography variant="h5">{summary?.winRate == null ? 'No decided trades' : `${summary.winRate}%`}</Typography>
          <Typography variant="body2" color="text.secondary">{summary?.wins ?? 0} wins · {summary?.losses ?? 0} losses · {summary?.count ?? 0} entries</Typography>
        </Paper>
        <Paper sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">Estimated P/L</Typography>
          <Typography variant="h5">{summary ? formatSignedUsd(Number(summary.totalEstimatedPnl)) : formatUsd(0)}</Typography>
        </Paper>
      </Stack>
      <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h6">{editingId ? 'Edit entry' : 'New entry'}</Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField label="Date" type="date" value={form.entryDate} onChange={(event) => setForm({ ...form, entryDate: event.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
            <TextField label="Ticker" value={form.ticker} onChange={(event) => setForm({ ...form, ticker: event.target.value })} fullWidth />
            <TextField label="Strategy" value={form.strategy} onChange={(event) => setForm({ ...form, strategy: event.target.value })} fullWidth />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField label="Entry premium" value={form.entryPremium} onChange={(event) => setForm({ ...form, entryPremium: event.target.value })} fullWidth />
            <TextField label="Exit premium" value={form.exitPremium} onChange={(event) => setForm({ ...form, exitPremium: event.target.value })} fullWidth />
            <TextField select label="Outcome" value={form.outcome} onChange={(event) => setForm({ ...form, outcome: event.target.value as TradeJournalWrite['outcome'] })} fullWidth>
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="win">Win</MenuItem>
              <MenuItem value="loss">Loss</MenuItem>
              <MenuItem value="scratch">Scratch</MenuItem>
            </TextField>
          </Stack>
          <TextField label="Tags" helperText="Separate tags with commas." value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} fullWidth />
          <TextField label="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} fullWidth multiline minRows={2} />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" disabled={busy} onClick={() => void save()}>{editingId ? 'Save changes' : 'Add entry'}</Button>
            {editingId ? <Button onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button> : null}
            <Button onClick={exportCsv} disabled={entries.length === 0}>Export CSV</Button>
          </Stack>
        </Stack>
      </Paper>
      <Stack spacing={1.25}>
        {entries.map((entry) => (
          <Paper key={entry.id} sx={{ p: 2 }}>
            <Typography variant="subtitle1">{entry.entryDate} · {entry.ticker} · {entry.strategy}</Typography>
            <Typography variant="body2" color="text.secondary">
              Entry {entry.entryPremium} · exit {entry.exitPremium ?? 'open'} · {entry.outcome}
              {entry.estimatedPnl ? ` · ${formatSignedUsd(Number(entry.estimatedPnl))}` : ''}
              {entry.tags.length > 0 ? ` · ${entry.tags.join(', ')}` : ''}
            </Typography>
            {entry.notes ? <Typography variant="body2" sx={{ mt: 0.5 }}>{entry.notes}</Typography> : null}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" onClick={() => {
                setEditingId(entry.id);
                setForm({
                  entryDate: entry.entryDate,
                  ticker: entry.ticker,
                  strategy: entry.strategy,
                  entryPremium: entry.entryPremium,
                  exitPremium: entry.exitPremium ?? '',
                  notes: entry.notes,
                  tags: entry.tags.join(', '),
                  outcome: entry.outcome,
                });
              }}>Edit</Button>
              <Button size="small" color="warning" onClick={() => void deleteTradeJournalEntry(entry.id).then(reload).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Delete failed.'))}>Delete</Button>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
