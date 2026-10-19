/**
 * Phase 1D.2a.5 — Persistent research session contracts (Finder + Discover).
 * Display restore must not imply live brokerage refresh.
 */

import { z } from 'zod';
import { discoveryToleranceSchema } from './discovery.js';
import { finderCandidateSchema, finderScanResultSchema } from './finder.js';
import { SCAN_MORE_PRIORITIES } from './finder-filters.js';
import { strategyProfileSchema } from './strategy-profile.js';
import { smartScanProgressSchema, smartScanResultSchema, smartScanTickerProgressSchema } from './smart-scan.js';

export const RESEARCH_SESSION_RETENTION_MAX = 40;

export const researchScanTypeSchema = z.enum(['finder', 'discover']);
export type ResearchScanType = z.infer<typeof researchScanTypeSchema>;

export const researchSessionStatusSchema = z.enum([
  'running',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);
export type ResearchSessionStatus = z.infer<typeof researchSessionStatusSchema>;

export const sessionPersistenceSchema = z.enum(['in-memory', 'sqlite']);
export type SessionPersistence = z.infer<typeof sessionPersistenceSchema>;

export const researchUiPrefsSchema = z
  .object({
    discoverView: z.enum(['gallery', 'list']).optional(),
    discoverGroupMode: z.enum(['all', 'by-company']).optional(),
    discoverFilters: z.record(z.unknown()).optional(),
    discoverSortValue: z.string().optional(),
    selectedCompareIds: z.array(z.string()).max(4).optional(),
    beginnerMode: z.boolean().optional(),
    finderView: z.enum(['gallery', 'list']).optional(),
    finderSort: z.string().max(64).optional(),
    finderFilters: z.record(z.unknown()).optional(),
    finderPresentation: z.string().max(64).optional(),
  })
  .strict();

export type ResearchUiPrefs = z.infer<typeof researchUiPrefsSchema>;

export const researchSessionSummarySchema = z
  .object({
    id: z.string().min(1),
    scanType: researchScanTypeSchema,
    status: researchSessionStatusSchema,
    universeId: z.string().nullable(),
    universeVersionId: z.string().nullable(),
    universeLabel: z.string().min(1),
    profileId: z.string().min(1),
    profileName: z.string().min(1),
    profileRevision: z.number().int().positive(),
    scanPriority: z.enum(SCAN_MORE_PRIORITIES),
    companiesProcessed: z.number().int().nonnegative(),
    companiesRemaining: z.number().int().nonnegative(),
    companiesInUniverse: z.number().int().nonnegative(),
    /** Attempted companies whose last attempt errored, was rate-limited, or was interrupted. */
    companiesRetryable: z.number().int().nonnegative().optional(),
    activeBatchId: z.string().nullable().optional(),
    contractsEvaluated: z.number().int().nonnegative(),
    canScanNextCompanies: z.boolean(),
    canScanMoreContracts: z.boolean(),
    persistence: sessionPersistenceSchema,
    simulated: z.boolean(),
    startedAt: z.string().min(1),
    updatedAt: z.string().min(1),
    finishedAt: z.string().nullable(),
    lastSuccessfulBatchAt: z.string().nullable(),
    nextActionHint: z.string().min(1),
    historicalNotice: z.string().min(1),
  })
  .strict();

export type ResearchSessionSummary = z.infer<typeof researchSessionSummarySchema>;

export const researchSessionListSchema = z
  .object({
    sessions: z.array(researchSessionSummarySchema),
  })
  .strict();

export type ResearchSessionList = z.infer<typeof researchSessionListSchema>;

/** Allowlisted Discover restore payload — no brokerage envelope. */
export const discoverResearchRestoreSchema = z
  .object({
    kind: z.literal('discover'),
    summary: researchSessionSummarySchema,
    result: smartScanResultSchema,
    strategySnapshot: strategyProfileSchema,
    orderedTickerQueue: z.array(z.string().min(1)),
    companyCursor: z.number().int().nonnegative(),
    evaluatedOcc: z.array(z.string().min(1)),
    uiPrefs: researchUiPrefsSchema,
    viewMode: z.enum(['view-saved', 'continue-ready']),
  })
  .strict();

export type DiscoverResearchRestore = z.infer<typeof discoverResearchRestoreSchema>;

export const finderResearchRestoreSchema = z
  .object({
    kind: z.literal('finder'),
    summary: researchSessionSummarySchema,
    result: finderScanResultSchema,
    strategySnapshot: strategyProfileSchema,
    evaluatedOcc: z.array(z.string().min(1)),
    uiPrefs: researchUiPrefsSchema,
    viewMode: z.enum(['view-saved', 'continue-ready']),
  })
  .strict();

export type FinderResearchRestore = z.infer<typeof finderResearchRestoreSchema>;

export const researchRestoreSchema = z.discriminatedUnion('kind', [
  discoverResearchRestoreSchema,
  finderResearchRestoreSchema,
]);

export type ResearchRestore = z.infer<typeof researchRestoreSchema>;

export const RESEARCH_HISTORICAL_NOTICE =
  'Restored saved research — quote and Greek timestamps are from the original observations. This is not a live market refresh.';

export const RESEARCH_INTERRUPTED_NOTICE =
  'This scan was interrupted (for example by an app restart). Saved results and coverage remain. Continuing requires an explicit Scan Next Companies or Scan More Contracts action and may request new provider data.';

/** Shown whenever a continuation must re-request an option chain that was loaded before. */
export const RESEARCH_REDISCOVERY_NOTICE =
  'Continuing re-requests option chains for companies with unevaluated contracts. Contracts already evaluated are skipped. Provider requests are not guaranteed to happen exactly once.';

/** Patch UI prefs / compare tray without market calls. */
export const researchUiPrefsPatchSchema = z
  .object({
    uiPrefs: researchUiPrefsSchema,
  })
  .strict();

export {
  smartScanProgressSchema,
  smartScanTickerProgressSchema,
  finderCandidateSchema,
  discoveryToleranceSchema,
};
