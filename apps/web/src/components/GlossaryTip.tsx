import type { ReactNode } from 'react';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { FINDER_GLOSSARY, type FinderGlossaryKey } from '@optionscout/shared';

export function GlossaryTip({ term, children }: { term: FinderGlossaryKey; children?: ReactNode }) {
  const entry = FINDER_GLOSSARY[term];
  return (
    <Tooltip
      arrow
      describeChild
      title={
        <Typography variant="caption" component="div" sx={{ maxWidth: 280 }}>
          <strong>{entry.title}.</strong> {entry.text}
        </Typography>
      }
    >
      <Typography
        component="span"
        variant="inherit"
        sx={{
          borderBottom: '1px dotted',
          borderColor: 'text.secondary',
          cursor: 'help',
        }}
      >
        {children ?? entry.title}
      </Typography>
    </Tooltip>
  );
}
