import { useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { validateTickerSymbol } from '@optionscout/shared';

const STORAGE_KEY = 'optionscout.watchlist';

interface WatchItem {
  ticker: string;
  addedAt: string;
}

function readItems(): WatchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchItem[];
    return Array.isArray(parsed) ? parsed.filter((row) => typeof row.ticker === 'string') : [];
  } catch {
    return [];
  }
}

export function WatchlistCard() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'az' | 'za' | 'newest'>('az');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setItems(readItems());
  }, []);

  function save(next: WatchItem[]) {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setNote('This browser did not store the watchlist.');
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((row) => row.ticker.toLowerCase().includes(needle));
    return [...filtered].sort((left, right) => {
      if (sort === 'za') return right.ticker.localeCompare(left.ticker);
      if (sort === 'newest') return right.addedAt.localeCompare(left.addedAt);
      return left.ticker.localeCompare(right.ticker);
    });
  }, [items, query, sort]);

  return (
    <Paper className="os-card" sx={{ p: { xs: 2, md: 2.5 } }} component="section" aria-label="Watchlist">
      <Typography variant="h6" component="h2">
        Watchlist
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Symbols you want to remember on this computer. Adding one does not look up a price and does not place an order.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
        <TextField
          size="small"
          label="Add a symbol"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="contained"
          onClick={() => {
            const checked = validateTickerSymbol(draft);
            if (!checked.ok) {
              setNote(checked.reason);
              return;
            }
            if (items.some((row) => row.ticker === checked.ticker)) {
              setNote(`${checked.ticker} is already on the watchlist.`);
              return;
            }
            save([{ ticker: checked.ticker, addedAt: new Date().toISOString() }, ...items]);
            setDraft('');
            setNote(null);
          }}
        >
          Add symbol
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
        <TextField size="small" label="Filter symbols" value={query} onChange={(event) => setQuery(event.target.value)} sx={{ flex: 1 }} />
        <TextField select size="small" label="Sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} sx={{ minWidth: 160 }}>
          <MenuItem value="az">A to Z</MenuItem>
          <MenuItem value="za">Z to A</MenuItem>
          <MenuItem value="newest">Newest</MenuItem>
        </TextField>
      </Stack>
      {note ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {note}
        </Typography>
      ) : null}
      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
        {visible.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No symbols yet. Try AAPL if you want a sample name.
          </Typography>
        ) : (
          visible.map((row) => (
            <Stack key={row.ticker} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              <Typography variant="body1" sx={{ fontFamily: 'var(--os-font-mono)' }}>
                {row.ticker}
              </Typography>
              <Button aria-label={`Remove ${row.ticker}`} onClick={() => save(items.filter((item) => item.ticker !== row.ticker))}>
                Remove
              </Button>
            </Stack>
          ))
        )}
      </Stack>
    </Paper>
  );
}
