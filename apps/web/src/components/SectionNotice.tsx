import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

export function SectionNotice({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Alert
      severity="error"
      sx={{ mt: 2, alignItems: 'flex-start' }}
      action={
        <Button color="inherit" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2">{message}</Typography>
    </Alert>
  );
}
