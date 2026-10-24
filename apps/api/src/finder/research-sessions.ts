/**
 * SQLite-backed research session persistence (Phase 1D.2a.5, hardened in 1D.2a.5c).
 * Restoring never triggers brokerage activity.
 *
 * Write model:
 *  - A session and its full ordered company membership are inserted once.
 *  - Every provider-backed operation first takes a database claim (one active batch per session).
 *  - Progress is committed incrementally (per company Stage A and per quote slice) in one
 *    transaction that also verifies the claim is still held.
 *  - A crash leaves committed rows intact; boot marks the claim interrupted and never resumes it.
 */

import type Database from 'better-sqlite3';
import {
  RESEARCH_HISTORICAL_NOTICE,
  RESEARCH_INTERRUPTED_NOTICE,
  RESEARCH_SESSION_RETENTION_MAX,
  SMART_SCAN_RETRYABLE_TICKER_STATUSES,
  finderScanResultSchema,
  smartScanResultSchema,
  strategyProfileSchema,
  type DiscoverResearchRestore,
  type FinderCandidate,
  type FinderResearchRestore,
  type FinderScanResult,
  type ResearchScanType,
  type ResearchSessionSummary,
  type ResearchUiPrefs,
  type SmartScanResult,
  type SmartScanTickerProgress,
  type StrategyProfile,
} from '@optionscout/shared';

type Sqlite = Database.Database;

export const RESEARCH_OWNER_SCOPE = 'local-owner';
/** A claim older than this is treated as abandoned (process died without boot cleanup). */
export const RESEARCH_CLAIM_LEASE_MS = 15 * 60_000;

const RETRYABLE_SQL_LIST = SMART_SCAN_RETRYABLE_TICKER_STATUSES.map((s) => `'${s}'`).join(', ');

export type ResearchBatchKind = 'companies' | 'contracts' | 'retry';

export class ResearchClaimError extends Error {
  constructor(
    message: string,
    readonly reason: 'busy' | 'cursor-moved' | 'lost' | 'not-found',
  ) {
    super(message);
  }
}

export class ResearchPersistenceError extends Error {}

export type CompanyWrite = {
  ticker: string;
  queueIndex: number;
  progress: SmartScanTickerProgress;
  remainingOcc: string[];
  lastError?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function leaseUntil(now: Date, leaseMs = RESEARCH_CLAIM_LEASE_MS): string {
  return new Date(now.getTime() + leaseMs).toISOString();
}

function nextActionHint(canNext: boolean, canMore: boolean, canRetry: boolean, status: string): string {
  if (status === 'running') return 'Scan in progress.';
  if (canRetry) return 'Some companies can be retried: use Retry Companies.';
  if (canNext) return 'Next available action: Scan Next Companies.';
  if (canMore) return 'Next available action: Scan More Contracts.';
  if (status === 'interrupted') return 'View saved results, or continue with an explicit scan action.';
  return 'No further batch actions available for this session.';
}

function enforceRetention(sqlite: Sqlite, scanType: ResearchScanType): void {
  const rows = sqlite
    .prepare(
      `SELECT id FROM research_sessions WHERE owner_scope = ? AND scan_type = ? ORDER BY updated_at DESC`,
    )
    .all(RESEARCH_OWNER_SCOPE, scanType) as Array<{ id: string }>;
  if (rows.length <= RESEARCH_SESSION_RETENTION_MAX) return;
  const drop = rows.slice(RESEARCH_SESSION_RETENTION_MAX);
  const tx = sqlite.transaction(() => {
    for (const row of drop) deleteSessionRows(sqlite, row.id, { onlyIfIdle: true });
  });
  tx();
}

function deleteSessionRows(sqlite: Sqlite, sessionId: string, options: { onlyIfIdle: boolean }): boolean {
  const removed = sqlite
    .prepare(
      `DELETE FROM research_sessions WHERE id = ? AND owner_scope = ?${
        options.onlyIfIdle ? ' AND active_batch_id IS NULL' : ''
      }`,
    )
    .run(sessionId, RESEARCH_OWNER_SCOPE);
  if (removed.changes !== 1) return false;
  sqlite.prepare(`DELETE FROM research_session_companies WHERE session_id = ?`).run(sessionId);
  sqlite.prepare(`DELETE FROM research_session_candidates WHERE session_id = ?`).run(sessionId);
  sqlite.prepare(`DELETE FROM research_session_evaluated_occ WHERE session_id = ?`).run(sessionId);
  sqlite.prepare(`DELETE FROM research_session_batches WHERE session_id = ?`).run(sessionId);
  return true;
}

export type BatchReconciliation = {
  batchId: string;
  status: string;
  planned: string[];
  committed: string[];
  retryable: string[];
};

/** Committed = OCC rows written under this batch id; retryable = planned but not committed. */
export function reconcileBatch(sqlite: Sqlite, batchId: string): BatchReconciliation | null {
  const batch = sqlite
    .prepare(`SELECT id, session_id, status, planned_occ_json FROM research_session_batches WHERE id = ?`)
    .get(batchId) as { id: string; session_id: string; status: string; planned_occ_json: string } | undefined;
  if (!batch) return null;
  const planned = parseJson<string[]>(batch.planned_occ_json, []);
  const committed = (
    sqlite
      .prepare(`SELECT occ_symbol FROM research_session_evaluated_occ WHERE session_id = ? AND batch_id = ?`)
      .all(batch.session_id, batchId) as Array<{ occ_symbol: string }>
  ).map((row) => row.occ_symbol);
  const committedSet = new Set(committed);
  return {
    batchId,
    status: batch.status,
    planned,
    committed,
    retryable: planned.filter((occ) => !committedSet.has(occ)),
  };
}

/**
 * Boot-time recovery: any claim left by a previous process is marked interrupted.
 * Committed candidates stay; uncommitted planned work and unattempted companies stay retryable.
 * Never restarts provider activity.
 */
export function markInterruptedRunningSessions(sqlite: Sqlite): number {
  const stuck = sqlite
    .prepare(
      `SELECT id, meta_json, active_batch_id FROM research_sessions
       WHERE status = 'running' OR active_batch_id IS NOT NULL`,
    )
    .all() as Array<{ id: string; meta_json: string; active_batch_id: string | null }>;
  if (stuck.length === 0) return 0;
  const ts = nowIso();
  const runningBatches = sqlite.prepare(
    `SELECT id FROM research_session_batches WHERE session_id = ? AND status = 'running'`,
  );
  const markBatch = sqlite.prepare(
    `UPDATE research_session_batches
     SET status = 'interrupted', finished_at = ?, updated_at = ?,
         error = 'Interrupted before this batch finished (for example by an app restart).'
     WHERE id = ?`,
  );
  const markCompanies = sqlite.prepare(
    `UPDATE research_session_companies
     SET status = 'interrupted',
         message = 'Interrupted before this company finished loading. Retry it explicitly.',
         updated_at = ?
     WHERE session_id = ? AND last_batch_id = ? AND status = 'pending'`,
  );
  const update = sqlite.prepare(
    `UPDATE research_sessions
     SET status = 'interrupted', updated_at = ?, active_lock_until = NULL, active_batch_id = NULL, meta_json = ?
     WHERE id = ?`,
  );
  const tx = sqlite.transaction(() => {
    for (const row of stuck) {
      const meta = parseJson<Record<string, unknown>>(row.meta_json, {});
      const notes: string[] = [];
      for (const batch of runningBatches.all(row.id) as Array<{ id: string }>) {
        markBatch.run(ts, ts, batch.id);
        markCompanies.run(ts, row.id, batch.id);
        const rec = reconcileBatch(sqlite, batch.id);
        if (rec && rec.planned.length > 0) {
          notes.push(
            `${rec.committed.length} of ${rec.planned.length} planned contracts were saved before the interruption; ${rec.retryable.length} remain queued.`,
          );
        }
      }
      meta.interruptedNotice = RESEARCH_INTERRUPTED_NOTICE;
      meta.message = [`Scan interrupted.`, ...notes, 'Continue only with an explicit action.'].join(' ');
      update.run(ts, JSON.stringify(meta), row.id);
    }
  });
  tx();
  return stuck.length;
}

// ---------------------------------------------------------------------------
// Discover sessions
// ---------------------------------------------------------------------------

export function discoverSessionColumns(
  result: SmartScanResult,
  orderedQueueLength: number,
  companyCursor: number,
): { progressJson: string; metaJson: string } {
  const meta = {
    mode: result.mode,
    simulated: result.simulated,
    simulatedNotice: result.simulatedNotice,
    dataSource: result.dataSource,
    sessionNotice: result.sessionNotice,
    message: result.message,
    error: result.error,
    persistenceError: result.persistenceError ?? null,
    insights: result.insights,
    startedAt: result.startedAt,
    profileName: result.profileName,
  };
  const progress = {
    ...result.progress,
    companiesInUniverseQueue: orderedQueueLength,
    companyCursor,
  };
  return { progressJson: JSON.stringify(progress), metaJson: JSON.stringify(meta) };
}

/** Insert a new Discover session and its whole ordered membership in one transaction. */
export function createDiscoverSession(
  sqlite: Sqlite,
  input: {
    result: SmartScanResult;
    strategySnapshot: StrategyProfile;
    orderedTickerQueue: string[];
    companies: SmartScanTickerProgress[];
  },
): void {
  const { result, strategySnapshot, orderedTickerQueue } = input;
  const ts = nowIso();
  const cols = discoverSessionColumns(result, orderedTickerQueue.length, 0);
  const insertSession = sqlite.prepare(
    `INSERT INTO research_sessions (
      id, owner_scope, scan_type, status, universe_id, universe_version_id, universe_label,
      ordered_ticker_queue_json, company_cursor, profile_id, profile_revision, strategy_snapshot_json,
      scan_priority, tolerances_json, ui_prefs_json, progress_json, meta_json,
      active_lock_until, active_batch_id, created_at, updated_at, finished_at
    ) VALUES (?, ?, 'discover', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, '{}', ?, ?, NULL, NULL, ?, ?, NULL)`,
  );
  const insertCompany = sqlite.prepare(
    `INSERT INTO research_session_companies (
      session_id, ticker, queue_index, status, message, company_name, underlying_price, underlying_quote_at,
      eligible_contracts, evaluated_contracts, incomplete_contracts, exact_matches, near_matches,
      remaining_occ_json, chain_as_of, last_error, attempt_count, last_batch_id, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, 0, 0, 0, 0, 0, '[]', NULL, NULL, 0, NULL, ?)`,
  );
  const byTicker = new Map(input.companies.map((row) => [row.ticker, row]));
  const tx = sqlite.transaction(() => {
    insertSession.run(
      result.scanId,
      RESEARCH_OWNER_SCOPE,
      result.status,
      result.universeId,
      result.universeVersionId ?? null,
      result.universeLabel,
      JSON.stringify(orderedTickerQueue),
      result.profileId,
      result.profileRevision,
      JSON.stringify(strategySnapshot),
      result.scanPriority,
      JSON.stringify(result.tolerances),
      cols.progressJson,
      cols.metaJson,
      result.startedAt,
      ts,
    );
    orderedTickerQueue.forEach((ticker, index) => {
      const row = byTicker.get(ticker);
      insertCompany.run(result.scanId, ticker, index, row?.message ?? 'Not examined yet.', row?.companyName ?? null, ts);
    });
  });
  tx();
  enforceRetention(sqlite, 'discover');
}

/**
 * Take the single active-batch claim for a session. When `cursor` is given the company cursor
 * advances atomically, so two concurrent Scan Next requests cannot both advance it.
 */
export function claimResearchBatch(
  sqlite: Sqlite,
  input: {
    sessionId: string;
    batchKind: ResearchBatchKind;
    tickers: string[];
    evaluationBudget: number;
    cursor?: { expected: number; next: number };
    now: Date;
    leaseMs?: number;
  },
): { batchId: string; seq: number } {
  const ts = input.now.toISOString();
  const tx = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT active_batch_id, active_lock_until, company_cursor FROM research_sessions WHERE id = ? AND owner_scope = ?`,
      )
      .get(input.sessionId, RESEARCH_OWNER_SCOPE) as
      | { active_batch_id: string | null; active_lock_until: string | null; company_cursor: number }
      | undefined;
    if (!row) throw new ResearchClaimError('Research session was not found.', 'not-found');
    const seqRow = sqlite
      .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM research_session_batches WHERE session_id = ?`)
      .get(input.sessionId) as { seq: number };
    const seq = Number(seqRow.seq);
    const batchId = `${input.sessionId}:b${seq}`;
    const changed = sqlite
      .prepare(
        `UPDATE research_sessions
         SET active_batch_id = ?, active_lock_until = ?, status = 'running', finished_at = NULL, updated_at = ?,
             company_cursor = COALESCE(?, company_cursor)
         WHERE id = ? AND owner_scope = ?
           AND (active_batch_id IS NULL OR active_lock_until IS NULL OR active_lock_until < ?)
           AND (? IS NULL OR company_cursor = ?)`,
      )
      .run(
        batchId,
        leaseUntil(input.now, input.leaseMs),
        ts,
        input.cursor ? input.cursor.next : null,
        input.sessionId,
        RESEARCH_OWNER_SCOPE,
        ts,
        input.cursor ? input.cursor.expected : null,
        input.cursor ? input.cursor.expected : null,
      );
    if (changed.changes !== 1) {
      const busy = row.active_batch_id != null && row.active_lock_until != null && row.active_lock_until >= ts;
      throw busy
        ? new ResearchClaimError('A scan operation is already running for this session.', 'busy')
        : new ResearchClaimError(
            'This session moved on since it was loaded (another Scan Next Companies request ran). Reload and try again.',
            'cursor-moved',
          );
    }
    sqlite
      .prepare(
        `INSERT INTO research_session_batches (
          id, session_id, seq, batch_kind, status, ticker_batch_json, planned_occ_json,
          evaluation_budget, evaluation_count, started_at, updated_at, finished_at, error
        ) VALUES (?, ?, ?, ?, 'running', ?, '[]', ?, 0, ?, ?, NULL, NULL)`,
      )
      .run(batchId, input.sessionId, seq, input.batchKind, JSON.stringify(input.tickers), input.evaluationBudget, ts, ts);
    if (input.batchKind !== 'contracts') {
      const bump = sqlite.prepare(
        `UPDATE research_session_companies
         SET attempt_count = attempt_count + 1, last_batch_id = ?, status = 'pending',
             message = 'Queued in the active batch.', updated_at = ?
         WHERE session_id = ? AND ticker = ?`,
      );
      for (const ticker of input.tickers) bump.run(batchId, ts, input.sessionId, ticker);
    }
    return { batchId, seq };
  });
  return tx();
}

/**
 * Commit a slice of progress for the claimed batch in one transaction.
 * Throws ResearchClaimError('lost') if another process/claim replaced this batch.
 */
export function commitResearchProgress(
  sqlite: Sqlite,
  input: {
    sessionId: string;
    batchId: string;
    status: string;
    progressJson: string;
    metaJson: string;
    finishedAt: string | null;
    companies?: CompanyWrite[];
    candidates?: FinderCandidate[];
    evaluatedOcc?: string[];
    plannedOcc?: string[];
    evaluationCount: number;
    now: Date;
    leaseMs?: number;
    finish?: { batchStatus: 'completed' | 'failed' | 'cancelled'; error: string | null };
  },
): void {
  const ts = input.now.toISOString();
  const tx = sqlite.transaction(() => {
    const updated = sqlite
      .prepare(
        `UPDATE research_sessions
         SET status = ?, progress_json = ?, meta_json = ?, updated_at = ?, finished_at = ?,
             active_lock_until = ?, active_batch_id = ?
         WHERE id = ? AND owner_scope = ? AND active_batch_id = ?`,
      )
      .run(
        input.finish ? input.status : 'running',
        input.progressJson,
        input.metaJson,
        ts,
        input.finish ? input.finishedAt : null,
        input.finish ? null : leaseUntil(input.now, input.leaseMs),
        input.finish ? null : input.batchId,
        input.sessionId,
        RESEARCH_OWNER_SCOPE,
        input.batchId,
      );
    if (updated.changes !== 1) {
      throw new ResearchClaimError(
        'This batch no longer holds the session claim (it was interrupted or replaced). Progress was not saved.',
        'lost',
      );
    }
    if (input.companies?.length) {
      const upsertCompany = sqlite.prepare(
        `INSERT INTO research_session_companies (
          session_id, ticker, queue_index, status, message, company_name, underlying_price, underlying_quote_at,
          eligible_contracts, evaluated_contracts, incomplete_contracts, exact_matches, near_matches,
          remaining_occ_json, chain_as_of, last_error, attempt_count, last_batch_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
        ON CONFLICT(session_id, ticker) DO UPDATE SET
          status = excluded.status,
          message = excluded.message,
          company_name = COALESCE(excluded.company_name, research_session_companies.company_name),
          underlying_price = excluded.underlying_price,
          underlying_quote_at = excluded.underlying_quote_at,
          eligible_contracts = excluded.eligible_contracts,
          evaluated_contracts = excluded.evaluated_contracts,
          incomplete_contracts = excluded.incomplete_contracts,
          exact_matches = excluded.exact_matches,
          near_matches = excluded.near_matches,
          remaining_occ_json = excluded.remaining_occ_json,
          chain_as_of = excluded.chain_as_of,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`,
      );
      for (const company of input.companies) {
        const p = company.progress;
        upsertCompany.run(
          input.sessionId,
          company.ticker,
          company.queueIndex,
          p.status,
          p.message,
          p.companyName,
          p.underlyingPrice,
          p.underlyingQuoteAt,
          p.eligibleContracts,
          p.evaluatedContracts,
          p.incompleteContracts,
          p.exactMatches,
          p.nearMatches,
          JSON.stringify(company.remainingOcc),
          p.underlyingQuoteAt,
          company.lastError ?? null,
          ts,
        );
      }
    }
    if (input.candidates?.length) {
      const upsertCandidate = sqlite.prepare(
        `INSERT INTO research_session_candidates (session_id, candidate_id, occ_symbol, underlying, snapshot_json, evaluated_at, batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, occ_symbol) DO UPDATE SET
           candidate_id = excluded.candidate_id,
           snapshot_json = excluded.snapshot_json,
           evaluated_at = excluded.evaluated_at,
           batch_id = excluded.batch_id`,
      );
      for (const candidate of input.candidates) {
        upsertCandidate.run(
          input.sessionId,
          candidate.id,
          candidate.occSymbol,
          candidate.underlying,
          JSON.stringify(candidate),
          ts,
          input.batchId,
        );
      }
    }
    if (input.evaluatedOcc?.length) {
      const insertOcc = sqlite.prepare(
        `INSERT OR IGNORE INTO research_session_evaluated_occ (session_id, occ_symbol, evaluated_at, batch_id) VALUES (?, ?, ?, ?)`,
      );
      for (const occ of input.evaluatedOcc) insertOcc.run(input.sessionId, occ, ts, input.batchId);
    }
    sqlite
      .prepare(
        `UPDATE research_session_batches
         SET evaluation_count = ?, updated_at = ?,
             planned_occ_json = COALESCE(?, planned_occ_json),
             status = COALESCE(?, status),
             finished_at = COALESCE(?, finished_at),
             error = COALESCE(?, error)
         WHERE id = ? AND session_id = ?`,
      )
      .run(
        input.evaluationCount,
        ts,
        input.plannedOcc ? JSON.stringify(input.plannedOcc) : null,
        input.finish?.batchStatus ?? null,
        input.finish ? ts : null,
        input.finish?.error ?? null,
        input.batchId,
        input.sessionId,
      );
  });
  tx();
}

/**
 * Extend the lease of a claim this operation still owns. Returns false when the claim was
 * released, interrupted, or taken by another batch (the batch ID is the fencing token).
 */
export function renewResearchClaim(
  sqlite: Sqlite,
  input: { sessionId: string; batchId: string; now: Date; leaseMs?: number },
): boolean {
  const updated = sqlite
    .prepare(
      `UPDATE research_sessions SET active_lock_until = ?
       WHERE id = ? AND owner_scope = ? AND active_batch_id = ?`,
    )
    .run(leaseUntil(input.now, input.leaseMs), input.sessionId, RESEARCH_OWNER_SCOPE, input.batchId);
  return updated.changes === 1;
}

/** Renew while an operation runs, so its lease never lapses mid-flight. One minute, well inside the lease. */
export const RESEARCH_CLAIM_HEARTBEAT_MS = 60_000;

export function startClaimHeartbeat(
  sqlite: Sqlite,
  input: {
    sessionId: string;
    batchId: string;
    now: () => Date;
    intervalMs?: number;
    onLost: () => void;
  },
): () => void {
  const timer = setInterval(() => {
    let owned = false;
    try {
      owned = renewResearchClaim(sqlite, { sessionId: input.sessionId, batchId: input.batchId, now: input.now() });
    } catch {
      owned = false;
    }
    if (!owned) {
      clearInterval(timer);
      input.onLost();
    }
  }, input.intervalMs ?? RESEARCH_CLAIM_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Best-effort claim release after a persistence failure; never throws. */
export function abandonResearchBatch(sqlite: Sqlite, sessionId: string, batchId: string, error: string): void {
  try {
    const ts = nowIso();
    const tx = sqlite.transaction(() => {
      sqlite
        .prepare(
          `UPDATE research_sessions SET status = 'failed', active_batch_id = NULL, active_lock_until = NULL, updated_at = ?, finished_at = ?
           WHERE id = ? AND active_batch_id = ?`,
        )
        .run(ts, ts, sessionId, batchId);
      sqlite
        .prepare(
          `UPDATE research_session_batches SET status = 'failed', finished_at = ?, updated_at = ?, error = ? WHERE id = ? AND status = 'running'`,
        )
        .run(ts, ts, error, batchId);
    });
    tx();
  } catch {
    /* Storage itself is failing; the in-memory result already reports persistenceError. */
  }
}

export function loadRemainingOccByTicker(sqlite: Sqlite, sessionId: string): Map<string, string[]> {
  const rows = sqlite
    .prepare(`SELECT ticker, remaining_occ_json FROM research_session_companies WHERE session_id = ?`)
    .all(sessionId) as Array<{ ticker: string; remaining_occ_json: string }>;
  return new Map(rows.map((row) => [row.ticker, parseJson<string[]>(row.remaining_occ_json, [])]));
}

function rowToDiscoverSummary(row: Record<string, unknown>): ResearchSessionSummary {
  const ordered = parseJson<string[]>(String(row.ordered_ticker_queue_json), []);
  const cursor = Number(row.company_cursor ?? 0);
  const progress = parseJson<Partial<SmartScanResult['progress']>>(String(row.progress_json), {});
  const meta = parseJson<{ profileName?: string; simulated?: boolean; startedAt?: string }>(
    String(row.meta_json),
    {},
  );
  const status = String(row.status) as ResearchSessionSummary['status'];
  const companiesRemaining = Math.max(0, ordered.length - cursor);
  const retryable = Number(row.retryable_count ?? 0);
  const idle = status !== 'running';
  const canScanNextCompanies = companiesRemaining > 0 && idle;
  const canScanMoreContracts = Boolean(progress.canScanMore) && idle;
  const lastBatch = row.last_batch_at != null ? String(row.last_batch_at) : null;
  return {
    id: String(row.id),
    scanType: 'discover',
    status,
    universeId: row.universe_id != null ? String(row.universe_id) : null,
    universeVersionId: row.universe_version_id != null ? String(row.universe_version_id) : null,
    universeLabel: String(row.universe_label),
    profileId: String(row.profile_id),
    profileName: meta.profileName ?? String(row.profile_id),
    profileRevision: Number(row.profile_revision),
    scanPriority: String(row.scan_priority) as ResearchSessionSummary['scanPriority'],
    companiesProcessed: Math.min(cursor, ordered.length),
    companiesRemaining,
    companiesInUniverse: ordered.length,
    companiesRetryable: retryable,
    activeBatchId: row.active_batch_id != null ? String(row.active_batch_id) : null,
    contractsEvaluated: Number(progress.contractsFullyEvaluated ?? 0),
    canScanNextCompanies,
    canScanMoreContracts,
    persistence: 'sqlite',
    simulated: Boolean(meta.simulated),
    startedAt: meta.startedAt ?? String(row.created_at),
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at != null ? String(row.finished_at) : null,
    lastSuccessfulBatchAt: lastBatch,
    nextActionHint: nextActionHint(canScanNextCompanies, canScanMoreContracts, retryable > 0 && idle, status),
    historicalNotice: status === 'interrupted' ? RESEARCH_INTERRUPTED_NOTICE : RESEARCH_HISTORICAL_NOTICE,
  };
}

const SUMMARY_SELECT = `SELECT s.*,
   (SELECT MAX(finished_at) FROM research_session_batches b
     WHERE b.session_id = s.id AND b.status = 'completed') AS last_batch_at,
   (SELECT COUNT(*) FROM research_session_companies c
     WHERE c.session_id = s.id AND c.status IN (${RETRYABLE_SQL_LIST})) AS retryable_count
 FROM research_sessions s`;

function rowToFinderSummary(row: Record<string, unknown>): ResearchSessionSummary {
  const meta = parseJson<{ profileName?: string; simulated?: boolean; startedAt?: string; underlying?: string }>(
    String(row.meta_json),
    {},
  );
  const progress = parseJson<{ contractsFullyEvaluated?: number; fullyEvaluated?: number; canScanMore?: boolean }>(
    String(row.progress_json),
    {},
  );
  const status = String(row.status) as ResearchSessionSummary['status'];
  const canMore = Boolean(progress.canScanMore) && status !== 'running';
  return {
    id: String(row.id),
    scanType: 'finder' as const,
    status,
    universeId: null,
    universeVersionId: null,
    universeLabel: meta.underlying ?? String(row.universe_label),
    profileId: String(row.profile_id),
    profileName: meta.profileName ?? String(row.profile_id),
    profileRevision: Number(row.profile_revision),
    scanPriority: String(row.scan_priority) as ResearchSessionSummary['scanPriority'],
    companiesProcessed: 1,
    companiesRemaining: 0,
    companiesInUniverse: 1,
    activeBatchId: row.active_batch_id != null ? String(row.active_batch_id) : null,
    contractsEvaluated: progress.fullyEvaluated ?? progress.contractsFullyEvaluated ?? 0,
    canScanNextCompanies: false,
    canScanMoreContracts: canMore,
    persistence: 'sqlite' as const,
    simulated: Boolean(meta.simulated),
    startedAt: meta.startedAt ?? String(row.created_at),
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at != null ? String(row.finished_at) : null,
    lastSuccessfulBatchAt: row.last_batch_at != null ? String(row.last_batch_at) : null,
    nextActionHint: nextActionHint(false, canMore, false, status),
    historicalNotice: status === 'interrupted' ? RESEARCH_INTERRUPTED_NOTICE : RESEARCH_HISTORICAL_NOTICE,
  };
}

export function listResearchSessions(
  sqlite: Sqlite,
  scanType: ResearchScanType,
  limit = 20,
): ResearchSessionSummary[] {
  const rows = sqlite
    .prepare(`${SUMMARY_SELECT} WHERE s.owner_scope = ? AND s.scan_type = ? ORDER BY s.updated_at DESC LIMIT ?`)
    .all(RESEARCH_OWNER_SCOPE, scanType, Math.min(40, Math.max(1, limit))) as Array<Record<string, unknown>>;
  return rows.map((row) => (scanType === 'discover' ? rowToDiscoverSummary(row) : rowToFinderSummary(row)));
}

function loadSummaryRow(sqlite: Sqlite, sessionId: string, scanType: ResearchScanType): Record<string, unknown> | null {
  const row = sqlite
    .prepare(`${SUMMARY_SELECT} WHERE s.id = ? AND s.owner_scope = ? AND s.scan_type = ?`)
    .get(sessionId, RESEARCH_OWNER_SCOPE, scanType) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function getLatestResearchSessionId(sqlite: Sqlite, scanType: ResearchScanType): string | null {
  const row = sqlite
    .prepare(
      `SELECT id FROM research_sessions WHERE owner_scope = ? AND scan_type = ? ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(RESEARCH_OWNER_SCOPE, scanType) as { id: string } | undefined;
  return row?.id ?? null;
}

const EMPTY_PROGRESS: SmartScanResult['progress'] = {
  companiesSelected: 0,
  companiesChainRetrieved: 0,
  companiesWithEvaluatedContracts: 0,
  companiesNotYetScanned: 0,
  companiesUnsupportedOrEmpty: 0,
  companiesRateLimitedOrError: 0,
  eligibleContractsDiscovered: 0,
  contractsFullyEvaluated: 0,
  contractsPartiallyEvaluated: 0,
  contractsNotYetEvaluated: 0,
  missingQuotesOrGreeks: 0,
  evaluationBudget: 0,
  evaluationBudgetUsed: 0,
  batchSize: 8,
  canScanMore: false,
  cancelled: false,
  plainSummary: '',
  coverageNote: '',
};

export function loadDiscoverRestore(sqlite: Sqlite, sessionId: string): DiscoverResearchRestore | null {
  const row = loadSummaryRow(sqlite, sessionId, 'discover');
  if (!row) return null;
  const meta = parseJson<Record<string, unknown>>(String(row.meta_json), {});
  const progress = parseJson<SmartScanResult['progress']>(String(row.progress_json), EMPTY_PROGRESS);
  const ordered = parseJson<string[]>(String(row.ordered_ticker_queue_json), []);
  const cursor = Number(row.company_cursor ?? 0);
  const strategySnapshot = strategyProfileSchema.parse(parseJson(String(row.strategy_snapshot_json), {}));
  const uiPrefs = parseJson<ResearchUiPrefs>(String(row.ui_prefs_json), {});
  const companies = sqlite
    .prepare(`SELECT * FROM research_session_companies WHERE session_id = ? ORDER BY queue_index ASC`)
    .all(sessionId) as Array<Record<string, unknown>>;
  const candidates = sqlite
    .prepare(
      `SELECT snapshot_json FROM research_session_candidates WHERE session_id = ? ORDER BY evaluated_at ASC, rowid ASC`,
    )
    .all(sessionId) as Array<{ snapshot_json: string }>;
  const occRows = sqlite
    .prepare(`SELECT occ_symbol FROM research_session_evaluated_occ WHERE session_id = ?`)
    .all(sessionId) as Array<{ occ_symbol: string }>;
  const status = String(row.status) as SmartScanResult['status'];
  const {
    canScanNextCompanies: _n,
    canScanMoreContracts: _m,
    companiesInUniverseQueue: _q,
    companyCursor: _c,
    ...progressCore
  } = progress as SmartScanResult['progress'] & Record<string, unknown>;
  const retryable = Number(row.retryable_count ?? 0);
  const result = smartScanResultSchema.parse({
    scanId: String(row.id),
    status,
    mode: meta.mode ?? 'simulated-fixture',
    profileId: String(row.profile_id),
    profileName: meta.profileName ?? strategySnapshot.name,
    profileRevision: Number(row.profile_revision),
    scanPriority: String(row.scan_priority),
    universeId: row.universe_id != null ? String(row.universe_id) : null,
    universeVersionId: row.universe_version_id != null ? String(row.universe_version_id) : null,
    universeLabel: String(row.universe_label),
    startedAt: String(meta.startedAt ?? row.created_at),
    finishedAt: row.finished_at != null ? String(row.finished_at) : null,
    updatedAt: String(row.updated_at),
    sessionPersistence: 'sqlite',
    sessionNotice: String(meta.sessionNotice ?? RESEARCH_HISTORICAL_NOTICE),
    message: String(meta.message ?? 'Restored saved Discover session.'),
    simulated: Boolean(meta.simulated),
    simulatedNotice: meta.simulatedNotice ?? null,
    dataSource: String(meta.dataSource ?? 'SQLite research session'),
    progress: { ...progressCore, canScanMore: Boolean(progress.canScanMore) },
    canScanNextCompanies: Math.max(0, ordered.length - cursor) > 0 && status !== 'running',
    companyCursor: cursor,
    companiesInUniverseQueue: ordered.length,
    companiesRetryable: retryable,
    activeBatchId: row.active_batch_id != null ? String(row.active_batch_id) : null,
    persistenceError: meta.persistenceError != null ? String(meta.persistenceError) : null,
    tickers: companies.map((c) => ({
      ticker: String(c.ticker),
      companyName: c.company_name != null ? String(c.company_name) : null,
      status: String(c.status),
      message: String(c.message),
      underlyingPrice: c.underlying_price != null ? String(c.underlying_price) : null,
      underlyingQuoteAt: c.underlying_quote_at != null ? String(c.underlying_quote_at) : null,
      eligibleContracts: Number(c.eligible_contracts ?? 0),
      evaluatedContracts: Number(c.evaluated_contracts ?? 0),
      incompleteContracts: Number(c.incomplete_contracts ?? 0),
      exactMatches: Number(c.exact_matches ?? 0),
      nearMatches: Number(c.near_matches ?? 0),
      attemptCount: Number(c.attempt_count ?? 0),
    })),
    insights: Array.isArray(meta.insights) ? meta.insights : [],
    candidates: candidates.map((c) => JSON.parse(c.snapshot_json)),
    tolerances: parseJson(String(row.tolerances_json), {}),
    error: meta.error != null ? String(meta.error) : null,
  });

  return {
    kind: 'discover',
    summary: rowToDiscoverSummary(row),
    result,
    strategySnapshot,
    orderedTickerQueue: ordered,
    companyCursor: cursor,
    evaluatedOcc: occRows.map((r) => r.occ_symbol),
    uiPrefs,
    viewMode: status === 'running' ? 'view-saved' : 'continue-ready',
  };
}

// ---------------------------------------------------------------------------
// Finder sessions
// ---------------------------------------------------------------------------

export function finderSessionColumns(result: FinderScanResult): { progressJson: string; metaJson: string } {
  const meta = {
    mode: result.mode,
    underlying: result.underlying,
    asOfDate: result.asOfDate,
    message: result.message,
    error: result.error,
    marketContext: result.marketContext,
    coverageNotes: result.coverageNotes,
    profileName: result.profileName,
    screeningFreshnessSeconds: result.screeningFreshnessSeconds,
    simulated: result.mode === 'demo-fixture',
    startedAt: result.startedAt,
  };
  return { progressJson: JSON.stringify(result.progress), metaJson: JSON.stringify(meta) };
}

/** Insert the Finder session header once (single underlying; candidates arrive via commits). */
export function createFinderSession(
  sqlite: Sqlite,
  input: { result: FinderScanResult; strategySnapshot: StrategyProfile },
): void {
  const { result, strategySnapshot } = input;
  const cols = finderSessionColumns(result);
  sqlite
    .prepare(
      `INSERT INTO research_sessions (
        id, owner_scope, scan_type, status, universe_id, universe_version_id, universe_label,
        ordered_ticker_queue_json, company_cursor, profile_id, profile_revision, strategy_snapshot_json,
        scan_priority, tolerances_json, ui_prefs_json, progress_json, meta_json,
        active_lock_until, active_batch_id, created_at, updated_at, finished_at
      ) VALUES (?, ?, 'finder', ?, NULL, NULL, ?, ?, 0, ?, ?, ?, ?, ?, '{}', ?, ?, NULL, NULL, ?, ?, NULL)`,
    )
    .run(
      result.scanId,
      RESEARCH_OWNER_SCOPE,
      result.status,
      result.underlying,
      JSON.stringify([result.underlying]),
      result.profileId,
      result.profileRevision,
      JSON.stringify(strategySnapshot),
      result.scanPriority,
      JSON.stringify(result.tolerances),
      cols.progressJson,
      cols.metaJson,
      result.startedAt,
      nowIso(),
    );
  enforceRetention(sqlite, 'finder');
}

export function loadFinderRestore(sqlite: Sqlite, sessionId: string): FinderResearchRestore | null {
  const row = loadSummaryRow(sqlite, sessionId, 'finder');
  if (!row) return null;
  const meta = parseJson<Record<string, unknown>>(String(row.meta_json), {});
  const strategySnapshot = strategyProfileSchema.parse(parseJson(String(row.strategy_snapshot_json), {}));
  const uiPrefs = parseJson<ResearchUiPrefs>(String(row.ui_prefs_json), {});
  const candidates = sqlite
    .prepare(
      `SELECT snapshot_json FROM research_session_candidates WHERE session_id = ? ORDER BY evaluated_at ASC, rowid ASC`,
    )
    .all(sessionId) as Array<{ snapshot_json: string }>;
  const occRows = sqlite
    .prepare(`SELECT occ_symbol FROM research_session_evaluated_occ WHERE session_id = ?`)
    .all(sessionId) as Array<{ occ_symbol: string }>;
  const result = finderScanResultSchema.parse({
    scanId: String(row.id),
    status: String(row.status),
    mode: meta.mode ?? 'demo-fixture',
    underlying: meta.underlying ?? String(row.universe_label),
    profileId: String(row.profile_id),
    profileName: meta.profileName ?? strategySnapshot.name,
    profileRevision: Number(row.profile_revision),
    scanPriority: String(row.scan_priority),
    startedAt: String(meta.startedAt ?? row.created_at),
    finishedAt: row.finished_at != null ? String(row.finished_at) : null,
    asOfDate: String(meta.asOfDate ?? String(row.created_at).slice(0, 10)),
    screeningFreshnessSeconds: Number(meta.screeningFreshnessSeconds ?? 60),
    sessionPersistence: 'sqlite',
    message: String(meta.message ?? 'Restored saved Finder session.'),
    progress: parseJson(String(row.progress_json), {}),
    coverageNotes: Array.isArray(meta.coverageNotes) ? meta.coverageNotes : [],
    marketContext: meta.marketContext ?? {
      underlyingPrice: null,
      underlyingQuoteAt: null,
      quoteSourceLabel: 'SQLite research session',
      quoteSkewWarning: null,
    },
    tolerances: parseJson(String(row.tolerances_json), {}),
    candidates: candidates.map((c) => JSON.parse(c.snapshot_json)),
    error: meta.error != null ? String(meta.error) : null,
  });
  return {
    kind: 'finder',
    summary: rowToFinderSummary(row),
    result,
    strategySnapshot,
    evaluatedOcc: occRows.map((r) => r.occ_symbol),
    uiPrefs,
    viewMode: result.status === 'running' ? 'view-saved' : 'continue-ready',
  };
}

// ---------------------------------------------------------------------------
// Shared session maintenance
// ---------------------------------------------------------------------------

/**
 * Delete one owner session and only its own rows. Refuses while a live claim is active.
 * Never touches brokerage, strategy, universe, or other sessions' rows.
 */
export function deleteResearchSession(sqlite: Sqlite, sessionId: string, now: Date = new Date()): boolean {
  const row = sqlite
    .prepare(`SELECT active_batch_id, active_lock_until FROM research_sessions WHERE id = ? AND owner_scope = ?`)
    .get(sessionId, RESEARCH_OWNER_SCOPE) as { active_batch_id: string | null; active_lock_until: string | null } | undefined;
  if (!row) return false;
  if (row.active_batch_id && row.active_lock_until && row.active_lock_until >= now.toISOString()) {
    throw new ResearchClaimError('This session has a scan in progress. Cancel it before deleting.', 'busy');
  }
  const tx = sqlite.transaction(() => deleteSessionRows(sqlite, sessionId, { onlyIfIdle: false }));
  return tx();
}

/** UI preferences only; does not change research activity timestamps. */
export function patchResearchUiPrefs(sqlite: Sqlite, sessionId: string, uiPrefs: ResearchUiPrefs): boolean {
  const updated = sqlite
    .prepare(`UPDATE research_sessions SET ui_prefs_json = ? WHERE id = ? AND owner_scope = ?`)
    .run(JSON.stringify(uiPrefs), sessionId, RESEARCH_OWNER_SCOPE);
  return updated.changes === 1;
}

export function getEvaluatedOccSet(sqlite: Sqlite, sessionId: string): Set<string> {
  const rows = sqlite
    .prepare(`SELECT occ_symbol FROM research_session_evaluated_occ WHERE session_id = ?`)
    .all(sessionId) as Array<{ occ_symbol: string }>;
  return new Set(rows.map((r) => r.occ_symbol));
}
