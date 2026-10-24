import { useEffect, useState } from 'react';
import {
  SAL_PMCC_DEEP_ITM,
  STRATEGY_FIELD_HELP,
  type StrategyProfile,
} from '@optionscout/shared';
import { SuccessToast } from '../brand/SuccessToast';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
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
import { SectionNotice } from '../components/SectionNotice';
import { parseMinExpirationDays, parseOptionalMoney, parseRequiredMoney } from '../lib/ruleFields';
import { useAppState } from '../state/AppState';

export function StrategyBuilderPage() {
  const { session, status, sessionError, retrySession } = useAppState();
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [selectedId, setSelectedId] = useState(SAL_PMCC_DEEP_ITM.id);
  const [draft, setDraft] = useState<StrategyProfile>(structuredClone(SAL_PMCC_DEEP_ITM));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [spreadError, setSpreadError] = useState<string | null>(null);
  const [minDaysError, setMinDaysError] = useState<string | null>(null);

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

  if (status === 'error') {
    return <SectionNotice title="Strategies are unavailable." message={sessionError ?? 'The session check failed.'} onRetry={retrySession} />;
  }
  if (status === 'loading') {
    return (
      <Stack role="status" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center', minHeight: 280 }}>
        <CircularProgress size={28} />
        <Typography>Loading strategies.</Typography>
      </Stack>
    );
  }
  if (!session?.authenticated) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 640 }}>
        <Typography variant="h4" component="h1">
          My Investing Rules
        </Typography>
        <Alert severity="info">Sign in to create and edit strategy profiles.</Alert>
        <Typography variant="body2" color="text.secondary">
          Rules live on this computer. Hard rules decide eligibility. Preferences separate a best match from a near match. Nothing here
          places an order.
        </Typography>
      </Stack>
    );
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
    <Stack spacing={2.5} sx={{ py: { xs: 0.5, md: 2 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' } }}>
        <Box sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="primary.main">
          Strategy rules
        </Typography>
        <Typography variant="h4" component="h1">
          My Investing Rules
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          Hard rules reject contracts. Preferred targets guide Near Match classification. Exploratory and display filters live
          on the LEAPS Finder and never silently rewrite a saved strategy. Each save creates a new revision so older scans
          and bookmarks keep their historical settings.
        </Typography>
        {draft.kind === 'builtin-template' ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {draft.referenceNote}
          </Typography>
        ) : null}
        </Box>
        <Chip label={`Revision ${draft.revision}`} variant="outlined" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
      </Stack>

      <SuccessToast message={notice} />
      {notice ? (
        <Alert severity={/fail|could not|invalid|unavailable/i.test(notice) ? 'error' : 'info'}>{notice}</Alert>
      ) : null}

      <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: { md: 'center' } }}>
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

      <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="overline" color="error.main">
          Hard rules
        </Typography>
        <Typography variant="h6">A. Hard requirements</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Contracts that miss these rules are Outside Profile (still visible for exploration).
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, '& .MuiFormControl-root': { width: '100%' } }}>
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
            type="number"
            value={draft.hard.minExpirationDays}
            error={Boolean(minDaysError)}
            helperText={minDaysError ?? STRATEGY_FIELD_HELP.hard.minExpirationDays.help}
            onChange={(event) => {
              const parsed = parseMinExpirationDays(event.target.value);
              setMinDaysError(parsed.error);
              if (parsed.value == null) return;
              setDraft((current) => ({
                ...current,
                hard: { ...current.hard, minExpirationDays: parsed.value ?? current.hard.minExpirationDays },
              }));
            }}
            fullWidth
          />
        </Box>
      </Paper>

      <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="overline" color="warning.main">
          Preferences
        </Typography>
        <Typography variant="h6">B. Preferred targets</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Missing a preference alone never hides a contract. Unconfigured liquidity stays Unassessed — not passed. A miss here is a
          Near Match when every hard rule passed.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, '& .MuiFormControl-root': { width: '100%' } }}>
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
            value={draft.preferences.maxBidAskSpreadPercent ?? ''}
            error={Boolean(spreadError)}
            helperText={spreadError ?? STRATEGY_FIELD_HELP.preferences.maxBidAskSpreadPercent.help}
            onChange={(event) => {
              const parsed = parseOptionalMoney(event.target.value);
              setSpreadError(parsed.error);
              if (parsed.error) return;
              setDraft((current) => ({
                ...current,
                preferences: { ...current.preferences, maxBidAskSpreadPercent: parsed.value },
              }));
            }}
          />
        </Box>
        <Alert severity="info" sx={{ mt: 2 }}>
          Open interest and volume stay off this form. Finder quotes cannot score them yet, so a save clears any stored minimum instead of treating a blank as a pass.
        </Alert>
        <Button
          sx={{ mt: 2 }}
          variant="contained"
          disabled={busy || Boolean(spreadError) || Boolean(minDaysError)}
          onClick={() =>
            void withBusy(async () => {
              const maxCost = parseRequiredMoney(draft.hard.maxContractCost, 'Maximum contract cost');
              const ideal = parseRequiredMoney(draft.preferences.idealContractCost, 'Ideal purchase cost');
              const days = parseMinExpirationDays(String(draft.hard.minExpirationDays));
              if (maxCost.error || ideal.error || days.error || maxCost.value == null || ideal.value == null || days.value == null) {
                setNotice(maxCost.error ?? ideal.error ?? days.error ?? 'Check the highlighted amounts.');
                return;
              }
              const saved = await updateStrategyProfile(selectedId, {
                ...draft,
                name: draft.name,
                hard: {
                  ...draft.hard,
                  maxContractCost: maxCost.value,
                  minExpirationDays: days.value,
                },
                preferences: {
                  ...draft.preferences,
                  idealContractCost: ideal.value,
                  minOpenInterest: null,
                  minVolume: null,
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
