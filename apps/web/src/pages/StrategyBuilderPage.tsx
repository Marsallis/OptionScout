import { useEffect, useState } from 'react';
import {
  SAL_PMCC_DEEP_ITM,
  STRATEGY_FIELD_HELP,
  type StrategyProfile,
} from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  createStrategyProfile,
  deleteStrategyProfile,
  duplicateStrategyProfile,
  fetchStrategyProfiles,
  resetBuiltinStrategyTemplate,
  saveStrategyProfileAs,
  setDefaultStrategyProfile,
  updateStrategyProfile,
} from '../api/client';
import { useAppState } from '../state/AppState';

function moneyOrBlank(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const normalized = /^\d+\.\d{2}$/.test(trimmed) ? trimmed : Number(trimmed).toFixed(2);
  return normalized;
}

export function StrategyBuilderPage() {
  const { session, status } = useAppState();
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [selectedId, setSelectedId] = useState(SAL_PMCC_DEEP_ITM.id);
  const [draft, setDraft] = useState<StrategyProfile>(structuredClone(SAL_PMCC_DEEP_ITM));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

  async function reload(): Promise<void> {
    const result = await fetchStrategyProfiles();
    setProfiles(result.profiles);
    const current = result.profiles.find((row) => row.id === selectedId) ?? result.profiles[0] ?? SAL_PMCC_DEEP_ITM;
    setSelectedId(current.id);
    setDraft(structuredClone(current));
  }

  useEffect(() => {
    if (!session?.authenticated) {
      setProfiles([]);
      return;
    }
    void reload().catch((reason) => setNotice(reason instanceof Error ? reason.message : 'Could not load strategies.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on auth only
  }, [session?.authenticated]);

  if (status === 'loading') return <Typography sx={{ mt: 4 }}>Loading strategies.</Typography>;
  if (!session?.authenticated) {
    return <Alert severity="info">Sign in to create and edit strategy profiles.</Alert>;
  }

  async function withBusy(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await reload();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Strategy update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2.5} sx={{ py: 2 }}>
      <Box>
        <Typography variant="h4">My Investing Rules</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Hard rules reject contracts. Preferred targets guide Near Match classification. Exploratory and display filters live
          on the LEAPS Finder and never silently rewrite a saved strategy. Each save creates a new revision so older scans
          and bookmarks keep their historical settings.
        </Typography>
      </Box>

      {notice ? <Alert severity="info">{notice}</Alert> : null}

      <Paper sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <TextField
            select
            label="Strategy"
            value={selectedId}
            onChange={(event) => {
              const next = profiles.find((row) => row.id === event.target.value);
              if (!next) return;
              setSelectedId(next.id);
              setDraft(structuredClone(next));
            }}
            sx={{ minWidth: 280 }}
          >
            {profiles.map((row) => (
              <MenuItem key={row.id} value={row.id}>
                {row.name}
                {row.isDefault ? ' (default)' : ''}
                {row.kind === 'builtin-template' ? ' · built-in' : ''} · rev {row.revision}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" disabled={busy} onClick={() => void withBusy(async () => {
            const created = await createStrategyProfile({ name: 'My LEAPS strategy' });
            setSelectedId(created.id);
            setNotice(`Created “${created.name}” (revision ${created.revision}).`);
          })}>
            Create
          </Button>
          <Button variant="outlined" disabled={busy} onClick={() => void withBusy(async () => {
            const copy = await duplicateStrategyProfile(selectedId);
            setSelectedId(copy.id);
            setNotice(`Duplicated as “${copy.name}”.`);
          })}>
            Duplicate
          </Button>
          <TextField
            label="Save As name"
            value={saveAsName}
            onChange={(event) => setSaveAsName(event.target.value)}
            sx={{ minWidth: 180 }}
          />
          <Button
            variant="outlined"
            disabled={busy || saveAsName.trim() === ''}
            onClick={() => void withBusy(async () => {
              const saved = await saveStrategyProfileAs(selectedId, saveAsName.trim());
              setSelectedId(saved.id);
              setSaveAsName('');
              setNotice(`Saved as “${saved.name}”.`);
            })}
          >
            Save As
          </Button>
          <Button variant="outlined" disabled={busy} onClick={() => void withBusy(async () => {
            await setDefaultStrategyProfile(selectedId);
            setNotice('Default strategy updated for new Finder searches.');
          })}>
            Set default
          </Button>
          {draft.kind === 'builtin-template' ? (
            <Button variant="outlined" color="warning" disabled={busy} onClick={() => void withBusy(async () => {
              const restored = await resetBuiltinStrategyTemplate();
              setDraft(structuredClone(restored));
              setNotice(`Built-in template reset to original defaults (revision ${restored.revision}). Prior revisions remain stored.`);
            })}>
              Reset to original defaults
            </Button>
          ) : (
            <Button
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete custom strategy “${draft.name}”? Prior revisions stay available for old bookmarks.`)) return;
                void withBusy(async () => {
                  await deleteStrategyProfile(selectedId);
                  setSelectedId(SAL_PMCC_DEEP_ITM.id);
                  setNotice('Custom strategy deleted.');
                });
              }}
            >
              Delete
            </Button>
          )}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6">A. Hard requirements</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Contracts that miss these rules are Outside Profile (still visible for exploration).
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <TextField
            label={STRATEGY_FIELD_HELP.hard.maxContractCost.label}
            helperText={STRATEGY_FIELD_HELP.hard.maxContractCost.help}
            value={draft.hard.maxContractCost}
            onChange={(event) =>
              setDraft((current) => ({ ...current, hard: { ...current.hard, maxContractCost: event.target.value } }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.hard.minLongDelta.label}
            helperText={STRATEGY_FIELD_HELP.hard.minLongDelta.help}
            value={draft.hard.minLongDelta}
            onChange={(event) =>
              setDraft((current) => ({ ...current, hard: { ...current.hard, minLongDelta: event.target.value } }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.hard.minExpirationDays.label}
            helperText={STRATEGY_FIELD_HELP.hard.minExpirationDays.help}
            type="number"
            value={draft.hard.minExpirationDays}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                hard: { ...current.hard, minExpirationDays: Number(event.target.value) || current.hard.minExpirationDays },
              }))
            }
          />
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6">B. Preferred targets</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Missing a preference alone never hides a contract. Unconfigured liquidity stays Unassessed — not passed.
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <TextField
            label={STRATEGY_FIELD_HELP.preferences.idealContractCost.label}
            helperText={STRATEGY_FIELD_HELP.preferences.idealContractCost.help}
            value={draft.preferences.idealContractCost}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferences: { ...current.preferences, idealContractCost: event.target.value },
              }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.preferences.preferredLongDelta.label}
            helperText={STRATEGY_FIELD_HELP.preferences.preferredLongDelta.help}
            value={draft.preferences.preferredLongDelta}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferences: { ...current.preferences, preferredLongDelta: event.target.value },
              }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.preferences.minIntrinsicPercent.label}
            helperText={STRATEGY_FIELD_HELP.preferences.minIntrinsicPercent.help}
            value={draft.preferences.minIntrinsicPercent}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferences: { ...current.preferences, minIntrinsicPercent: event.target.value },
              }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.preferences.maxBidAskSpreadPercent.label}
            helperText={STRATEGY_FIELD_HELP.preferences.maxBidAskSpreadPercent.help}
            value={draft.preferences.maxBidAskSpreadPercent ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferences: { ...current.preferences, maxBidAskSpreadPercent: moneyOrBlank(event.target.value) },
              }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.preferences.minOpenInterest.label}
            helperText={`${STRATEGY_FIELD_HELP.preferences.minOpenInterest.help} Not available yet for most Finder quotes.`}
            value={draft.preferences.minOpenInterest ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  minOpenInterest: event.target.value.trim() === '' ? null : Number(event.target.value),
                },
              }))
            }
          />
          <TextField
            label={STRATEGY_FIELD_HELP.preferences.minVolume.label}
            helperText={`${STRATEGY_FIELD_HELP.preferences.minVolume.help} Not available yet when the provider omits volume.`}
            value={draft.preferences.minVolume ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  minVolume: event.target.value.trim() === '' ? null : Number(event.target.value),
                },
              }))
            }
          />
        </Stack>
        <Button
          sx={{ mt: 2 }}
          variant="contained"
          disabled={busy}
          onClick={() =>
            void withBusy(async () => {
              const saved = await updateStrategyProfile(selectedId, {
                ...draft,
                name: draft.name,
                hard: {
                  ...draft.hard,
                  maxContractCost: Number(draft.hard.maxContractCost).toFixed(2),
                },
                preferences: {
                  ...draft.preferences,
                  idealContractCost: Number(draft.preferences.idealContractCost).toFixed(2),
                },
              });
              setDraft(structuredClone(saved));
              setNotice(`Saved “${saved.name}” as revision ${saved.revision}. Older revisions stay available for prior scans.`);
            })
          }
        >
          Save new revision
        </Button>
      </Paper>

      <Alert severity="info" icon={false}>
        C. Exploratory tolerances and D. Display-only filters are adjusted on the LEAPS Finder screen. Changing them does not
        rewrite this saved strategy. Mid-search strategy changes require starting a new scan so results are not mixed across
        profile revisions.
      </Alert>
    </Stack>
  );
}
