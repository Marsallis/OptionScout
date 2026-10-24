import Button from '@mui/material/Button';
import { useAppState } from '../state/AppState';

const INSTALL_HREF = 'https://github.com/Marsallis/OptionScout/blob/main/README.md#try-it-on-one-screen';

export function LocalInstallNote() {
  const { session } = useAppState();
  if (session?.publicSimulatedDemo !== true) return null;
  return (
    <Button
      component="a"
      href={INSTALL_HREF}
      target="_blank"
      rel="noopener noreferrer"
      variant="outlined"
      sx={{ alignSelf: 'flex-start', textAlign: 'left', maxWidth: 720 }}
    >
      Want to connect your own broker? Download OptionScout and run it on your computer, where your login never leaves your machine.
    </Button>
  );
}
