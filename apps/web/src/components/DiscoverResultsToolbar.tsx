import type { DiscoverResultFilters, StrategyEligibility } from '@optionscout/shared';
import { describeActiveDiscoverFilters } from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

export type DiscoverResultsView = 'gallery' | 'list';
export type DiscoverGroupMode = 'all' | 'by-company';

export function DiscoverResultsToolbar({
  filters,
  onChange,
  onClear,
  view,
  onViewChange,
  groupMode,
  onGroupModeChange,
  sortValue,
  onSortChange,
  sortOptions,
  tickerOptions,
  showing,
  total,
  sticky = true,
}: {
  filters: DiscoverResultFilters;
  onChange: (next: DiscoverResultFilters) => void;
  onClear: () => void;
  view: DiscoverResultsView;
  onViewChange: (view: DiscoverResultsView) => void;
  groupMode: DiscoverGroupMode;
  onGroupModeChange: (mode: DiscoverGroupMode) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  sortOptions: ReadonlyArray<{ value: string; label: string }>;
  tickerOptions: string[];
  showing: number;
  total: number;
  sticky?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const chips = describeActiveDiscoverFilters(filters);

  return (
    <Paper
      elevation={sticky ? 3 : 0}
      variant={sticky ? 'elevation' : 'outlined'}
      sx={{
        p: 1.5,
        position: sticky ? 'sticky' : 'relative',
        top: sticky ? 8 : undefined,
        zIndex: sticky ? 12 : undefined,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Ticker / company"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            sx={{ minWidth: 160, flex: 1 }}
          />
          <TextField
            size="small"
            type="number"
            label="Max purchase cost"
            value={filters.maxCost ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ ...filters, maxCost: raw === '' ? null : Number(raw) });
            }}
            sx={{ width: 160 }}
            inputProps={{ min: 0, step: 100 }}
          />
          <TextField
            select
            size="small"
            label="Eligibility"
            value={filters.eligibility}
            onChange={(event) =>
              onChange({ ...filters, eligibility: event.target.value as DiscoverResultFilters['eligibility'] })
            }
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="any">Any eligibility</MenuItem>
            <MenuItem value="eligible">Eligible</MenuItem>
            <MenuItem value="not-eligible">Not Eligible</MenuItem>
            <MenuItem value={'cannot-verify' as StrategyEligibility}>Cannot Verify</MenuItem>
          </TextField>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_e, value: DiscoverResultsView | null) => {
              if (value) onViewChange(value);
            }}
          >
            <ToggleButton value="gallery">Gallery</ToggleButton>
            <ToggleButton value="list">List</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" onClick={() => setAdvancedOpen((open) => !open)}>
            Advanced Filters
          </Button>
          <Button size="small" disabled={chips.length === 0} onClick={onClear}>
            Clear Filters
          </Button>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={groupMode}
            onChange={(_e, value: DiscoverGroupMode | null) => {
              if (value) onGroupModeChange(value);
            }}
          >
            <ToggleButton value="all">All Companies</ToggleButton>
            <ToggleButton value="by-company">Group by Company</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            label="Sort"
            value={sortValue}
            onChange={(event) => onSortChange(event.target.value)}
            sx={{ minWidth: 240 }}
          >
            {sortOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
            Showing {showing} of {total} evaluated contracts
          </Typography>
        </Stack>

        {chips.length > 0 ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {chips.map((chip) => (
              <Chip key={chip} size="small" label={chip} />
            ))}
          </Stack>
        ) : null}

        <Typography variant="caption" color="text.secondary">
          Filters apply to evaluated contracts only and do not edit your saved strategy or request new market data.
        </Typography>

        <Collapse in={advancedOpen}>
          <Box sx={{ pt: 1, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Tickers in this scan
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                {tickerOptions.map((ticker) => {
                  const on = filters.tickers.includes(ticker);
                  return (
                    <Chip
                      key={ticker}
                      size="small"
                      label={ticker}
                      color={on ? 'primary' : 'default'}
                      variant={on ? 'filled' : 'outlined'}
                      onClick={() =>
                        onChange({
                          ...filters,
                          tickers: on
                            ? filters.tickers.filter((t) => t !== ticker)
                            : [...filters.tickers, ticker],
                        })
                      }
                    />
                  );
                })}
              </Stack>
            </Box>
            <TextField
              size="small"
              type="number"
              label="Min cost"
              value={filters.minCost ?? ''}
              onChange={(event) =>
                onChange({ ...filters, minCost: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
            <TextField
              size="small"
              type="number"
              label="Min delta"
              value={filters.minDelta ?? ''}
              onChange={(event) =>
                onChange({ ...filters, minDelta: event.target.value === '' ? null : Number(event.target.value) })
              }
              inputProps={{ step: 0.01, min: 0, max: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label="Min intrinsic %"
              value={filters.minIntrinsicPercent ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  minIntrinsicPercent: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
            <TextField
              size="small"
              type="number"
              label="Min DTE"
              value={filters.minDte ?? ''}
              onChange={(event) =>
                onChange({ ...filters, minDte: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
            <TextField
              size="small"
              type="number"
              label="Max DTE"
              value={filters.maxDte ?? ''}
              onChange={(event) =>
                onChange({ ...filters, maxDte: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
            <TextField
              size="small"
              type="number"
              label="Max spread %"
              value={filters.maxSpreadPercent ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  maxSpreadPercent: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
            <TextField
              select
              size="small"
              label="Preferences"
              value={filters.prefs}
              onChange={(event) =>
                onChange({ ...filters, prefs: event.target.value as DiscoverResultFilters['prefs'] })
              }
            >
              <MenuItem value="any">Any preferences</MenuItem>
              <MenuItem value="all-met">All preferences met</MenuItem>
              <MenuItem value="some-missed">Some preferences missed</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Missing data"
              value={filters.missingData}
              onChange={(event) =>
                onChange({ ...filters, missingData: event.target.value as DiscoverResultFilters['missingData'] })
              }
            >
              <MenuItem value="any">Any completeness</MenuItem>
              <MenuItem value="has-missing">Has missing / unassessed</MenuItem>
              <MenuItem value="fully-assessed">Fully assessed</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Data freshness"
              value={filters.freshness}
              onChange={(event) =>
                onChange({ ...filters, freshness: event.target.value as DiscoverResultFilters['freshness'] })
              }
            >
              <MenuItem value="any">Any freshness</MenuItem>
              <MenuItem value="Live">Live</MenuItem>
              <MenuItem value="Previous Session">Previous Session</MenuItem>
              <MenuItem value="Cached">Cached</MenuItem>
              <MenuItem value="Older">Older</MenuItem>
              <MenuItem value="Partial">Partial</MenuItem>
            </TextField>
          </Box>
        </Collapse>
      </Stack>
    </Paper>
  );
}
