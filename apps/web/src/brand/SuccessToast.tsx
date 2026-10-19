import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';

/** Compact confirmation for a server-confirmed save. Failures stay in the page notice. */
export function SuccessToast({ message }: { message: string | null }) {
  const open = Boolean(message && /^Saved\b/i.test(message));
  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      sx={{ '@media (prefers-reduced-motion: no-preference)': { '& .MuiSnackbarContent-root, & .MuiPaper-root': { animation: 'os-toast 180ms var(--os-ease) both' } } }}
    >
      <Alert severity="success" variant="outlined" role="status">
        {message}
      </Alert>
    </Snackbar>
  );
}
