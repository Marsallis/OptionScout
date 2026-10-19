import { useEffect, useMemo, useState } from 'react';
import type { SmartScanResult } from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { AppMark } from '../brand/AppMark';

export type ScanUiStage =
  | 'idle'
  | 'preparing'
  | 'retrieving'
  | 'evaluating'
  | 'scanning'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** Derive UI stage from backend status + counters — never invent stage without evidence. */
export function deriveScanUiStage(scan: SmartScanResult | null): ScanUiStage {
  if (!scan) return 'idle';
  if (scan.status === 'cancelled' || scan.progress.cancelled) return 'cancelled';
  if (scan.status === 'failed') return 'failed';
  if (scan.status === 'completed') return 'completed';
  if (scan.status !== 'running') return 'idle';

  const p = scan.progress;
  if (p.evaluationBudgetUsed === 0 && p.companiesChainRetrieved === 0) return 'preparing';
  if (p.companiesChainRetrieved > 0 && p.contractsFullyEvaluated === 0 && p.companiesNotYetScanned > 0) {
    return 'retrieving';
  }
  if (p.contractsFullyEvaluated > 0 || p.evaluationBudgetUsed > 0) return 'evaluating';
  return 'scanning';
}

function stageCaption(stage: ScanUiStage): string {
  if (stage === 'preparing') return 'Preparing scan…';
  if (stage === 'retrieving') return 'Retrieving option chains…';
  if (stage === 'evaluating') return 'Evaluating prices and available Greeks…';
  if (stage === 'scanning') return 'Scanning contracts…';
  if (stage === 'completed') return 'This batch is finished. Review the results, or continue when you are ready.';
  if (stage === 'cancelled') return 'This look was cancelled.';
  if (stage === 'failed') return 'This look stopped before it finished.';
  return 'Idle';
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

/** True while contracts are still being retrieved or the client is chaining the next batch. */
export function scanProgressIsOpen(status: SmartScanResult['status'] | undefined, stillWorking: boolean): boolean {
  return stillWorking || status === 'running';
}

export function SmartScanProgressPanel({
  scan,
  stillWorking = false,
  onScanMore,
  onScanNextCompanies,
  onRunNewSearch,
  onCancel,
  scanMoreDisabled,
  scanNextDisabled,
  cancelDisabled,
}: {
  scan: SmartScanResult | null;
  stillWorking?: boolean;
  onScanMore: () => void;
  onScanNextCompanies?: () => void;
  onRunNewSearch?: () => void;
  onCancel: () => void;
  scanMoreDisabled?: boolean;
  scanNextDisabled?: boolean;
  cancelDisabled?: boolean;
}) {
  const stage = useMemo(() => deriveScanUiStage(scan), [scan]);
  const reducedMotion = usePrefersReducedMotion();
  const open = scanProgressIsOpen(scan?.status, stillWorking);
  const running = open || stage === 'preparing' || stage === 'retrieving' || stage === 'evaluating' || stage === 'scanning';

  if (!scan) return null;

  const p = scan.progress;
  const budgetPct =
    p.evaluationBudget > 0 ? Math.min(100, Math.round((p.evaluationBudgetUsed / p.evaluationBudget) * 100)) : 0;
  const companiesAttempted = scan.tickers.filter((row) => (row.attemptCount ?? 0) > 0).length;
  const caption = open ? 'Retrieving and evaluating contracts. This is not a finished outcome.' : stageCaption(stage);

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <AppMark size={72} researching={running && !reducedMotion} title={running ? 'Research in progress' : 'OptionScout'} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6">Research so far</Typography>
          <Typography variant="body1" sx={{ fontWeight: 650, mt: 0.5 }}>
            {caption}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {p.plainSummary}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1.25, flexWrap: 'wrap', gap: 1 }}>
            <Stat label="Companies attempted" value={`${companiesAttempted} of ${scan.companiesInUniverseQueue ?? p.companiesSelected}`} />
            <Stat label="Companies with contracts evaluated" value={`${p.companiesWithEvaluatedContracts}`} />
            <Stat label="Companies that need another try" value={`${p.companiesRateLimitedOrError}`} />
            <Stat label="Companies not yet examined" value={`${Math.max(0, (scan.companiesInUniverseQueue ?? p.companiesSelected) - (scan.companyCursor ?? p.companiesChainRetrieved))}`} />
            <Stat label="Contracts evaluated" value={`${p.contractsFullyEvaluated}`} />
            <Stat
              label="Contracts not yet evaluated"
              value={
                p.contractsNotYetEvaluated > 0
                  ? `${p.contractsNotYetEvaluated}`
                  : p.companiesChainRetrieved > 0
                    ? '0'
                    : 'Unknown until a chain is read'
              }
            />
          </Stack>
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Companies processed and companies remaining are separate from contracts evaluated. A budget of{' '}
              {p.evaluationBudget} contracts is not a complete LEAPS search.
            </Typography>
            <LinearProgress
              variant={open ? 'indeterminate' : 'determinate'}
              value={open ? undefined : budgetPct}
              sx={{ mt: 0.5, height: 8, borderRadius: 1 }}
            />
          </Box>
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
            {onScanNextCompanies && (scan.canScanNextCompanies ?? false) ? (
              <Button
                variant="contained"
                disabled={scanNextDisabled || running}
                onClick={onScanNextCompanies}
              >
                Continue Search
              </Button>
            ) : null}
            <Button
              variant={(scan.canScanNextCompanies ?? false) ? 'outlined' : 'contained'}
              disabled={scanMoreDisabled || !p.canScanMore}
              onClick={onScanMore}
            >
              Scan More Contracts
            </Button>
            <Button variant="outlined" disabled={cancelDisabled || !running} onClick={onCancel}>
              Cancel
            </Button>
            {onRunNewSearch && !open ? (
              <Button variant="outlined" onClick={onRunNewSearch}>
                Run New Search
              </Button>
            ) : null}
          </Stack>
          {!open && stage === 'completed' && (scan.canScanNextCompanies ?? false) ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Continue Search looks at the rest of the companies you already checked. It does not start by itself after you leave this page.
            </Typography>
          ) : null}
          {!open && stage === 'completed' && p.canScanMore && !(scan.canScanNextCompanies ?? false) ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Next step: Scan More Contracts for the companies already opened. That does not add companies.
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </Paper>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}
