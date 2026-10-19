import { useState } from 'react';
import { PMCC_EXPLAINER_SECTIONS } from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export function PmccExplainer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Button size="small" onClick={() => setOpen((value) => !value)} sx={{ textTransform: 'none' }}>
        {open ? 'Hide: What is a PMCC?' : 'What is a PMCC?'}
      </Button>
      <Collapse in={open}>
        <Stack spacing={1.5} sx={{ mt: 1.25 }}>
          {PMCC_EXPLAINER_SECTIONS.map((section) => (
            <Box key={section.title}>
              <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
                {section.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                {section.body}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
