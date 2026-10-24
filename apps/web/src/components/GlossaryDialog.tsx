import { useMemo, useState } from 'react';
import { FINDER_GLOSSARY } from '@optionscout/shared';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

const ORDER = [
  'callOption',
  'put',
  'strike',
  'expiration',
  'iv',
  'delta',
  'theta',
  'leaps',
  'pmcc',
  'assignment',
  'breakeven',
  'premium',
  'intrinsic',
  'extrinsic',
  'spread',
  'multiplier',
  'openInterest',
] as const;

export function GlossaryDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const terms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ORDER.map((key) => FINDER_GLOSSARY[key]).filter((entry) => {
      if (!needle) return true;
      return `${entry.title} ${entry.text}`.toLowerCase().includes(needle);
    });
  }, [query]);

  return (
    <>
      <Button aria-haspopup="dialog" onClick={() => setOpen(true)} sx={{ minHeight: 44 }}>
        Glossary
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="glossary-title">
        <DialogTitle id="glossary-title">What these words mean</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Search the glossary"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ mb: 2 }}
          />
          <Stack spacing={1.5} component="dl" sx={{ m: 0 }}>
            {terms.map((entry) => (
              <Stack key={entry.title} component="div" spacing={0.25}>
                <Typography component="dt" variant="subtitle2">
                  {entry.title}
                </Typography>
                <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0 }}>
                  {entry.text}
                </Typography>
              </Stack>
            ))}
            {terms.length === 0 ? <Typography variant="body2">No matching term.</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
