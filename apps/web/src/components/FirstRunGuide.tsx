import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

const STORAGE_KEY = 'optionscout.firstRunDismissed';

export function FirstRunGuide() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // The guide can be opened again from this page.
    }
  }

  if (dismissed) {
    return (
      <Button size="small" onClick={() => setDismissed(false)}>
        Show the welcome guide
      </Button>
    );
  }

  return (
    <Paper className="os-card" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-label="Welcome guide">
      <Typography variant="overline" color="primary.main">
        First visit
      </Typography>
      <Typography variant="h5" component="h2" sx={{ mt: 0.5 }}>
        A calm place to learn options research
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 1.5, maxWidth: 720 }}>
        <Typography variant="body1">
          Start with the simulated book. The prices are fictional, so you can click around without a brokerage account.
        </Typography>
        <Typography variant="body1">
          A call is the right to buy shares later at a fixed price. A LEAPS call simply lasts a long time. You can lose the premium you
          pay. You do not have to go further than that today.
        </Typography>
        <Typography variant="body1">
          When a word is unfamiliar, open Glossary. Nothing on this desk places an order.
        </Typography>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
        <Button variant="contained" component={RouterLink} to="/discover">
          Look at company lists
        </Button>
        <Button variant="outlined" component={RouterLink} to="/risk">
          See a simple payoff chart
        </Button>
        <Button onClick={dismiss}>Got it</Button>
      </Stack>
    </Paper>
  );
}
