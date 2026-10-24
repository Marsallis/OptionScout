import { Link as RouterLink } from 'react-router-dom';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DemoChip } from '../components/DemoChip';

export function PlaceholderPage({ title, paragraphs }: { title: string; paragraphs: string[] }) {
  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <DemoChip />
      </Stack>
      <Paper sx={{ p: { xs: 2.5, md: 3 }, maxWidth: 760 }}>
        <Typography variant="overline" color="warning.main">
          Not built yet
        </Typography>
        <Typography variant="h6" sx={{ mt: 1 }}>
          This screen is a placeholder.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          It does not calculate, import, or submit anything. The simulated book on Overview is the working example.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {paragraphs.map((paragraph) => (
            <Typography key={paragraph} color="text.secondary">
              {paragraph}
            </Typography>
          ))}
        </Stack>
        <Button component={RouterLink} to="/" variant="contained" sx={{ mt: 2.5 }}>
          Back to the demo book
        </Button>
      </Paper>
    </Stack>
  );
}
