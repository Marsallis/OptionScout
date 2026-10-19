import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DemoChip } from '../components/DemoChip';

export function PlaceholderPage({ title, paragraphs }: { title: string; paragraphs: string[] }) {
  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <DemoChip />
      </Stack>
      <Paper sx={{ p: { xs: 2.5, md: 3 }, maxWidth: 760 }}>
        <Typography variant="overline" color="primary.main">
          Planned for a later phase
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {paragraphs.map((paragraph) => (
            <Typography key={paragraph} color="text.secondary">
              {paragraph}
            </Typography>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
