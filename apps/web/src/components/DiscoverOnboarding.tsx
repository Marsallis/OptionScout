import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

const STORAGE_KEY = 'optionscout.discoverOnboardingDismissed';

export function DiscoverOnboarding() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed && !open) {
    return (
      <Button size="small" onClick={() => setOpen(true)}>
        How it works
      </Button>
    );
  }

  return (
    <Alert
      severity="info"
      icon={false}
      action={
        <Stack direction="row" spacing={0.5}>
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setOpen(false);
              setDismissed(true);
              try {
                localStorage.setItem(STORAGE_KEY, '1');
              } catch {
                /* ignore */
              }
            }}
          >
            Dismiss
          </Button>
        </Stack>
      }
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
        How it works
      </Typography>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ mt: 0.75 }}>
          <Typography variant="body2">
            A LEAPS call is a long-dated call option. OptionScout finds contracts that match your saved hard rules and
            preferences.
          </Typography>
          <Typography variant="body2">
            An eligible contract is not a guaranteed profitable trade. Bid/ask spread and quote freshness still matter.
          </Typography>
          <Typography variant="body2">
            A Poor Man’s Covered Call (PMCC) is an optional next step that pairs a LEAPS with shorter-dated short calls —
            not required to explore LEAPS here.
          </Typography>
          <Typography variant="body2">
            Saved research stays on this computer. Opening it does not refresh prices. Each search step looks at a limited
            number of contracts, not every LEAPS listing.
          </Typography>
        </Stack>
      </Collapse>
    </Alert>
  );
}
