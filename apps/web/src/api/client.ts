import {
  brokerOverviewSchema,
  dashboardSchema,
  finderBookmarkSchema,
  finderBookmarksResponseSchema,
  finderRetryMissingRequestSchema,
  finderScanMoreRequestSchema,
  finderScanRequestSchema,
  finderScanResultSchema,
  discoveryUniverseSchema,
  smartScanMoreRequestSchema,
  smartScanNextCompaniesRequestSchema,
  smartScanPolicySchema,
  smartScanRequestSchema,
  smartScanResultSchema,
  smartScanRetryCompaniesRequestSchema,
  type HoldingsMappableRole,
  portfolioSchema,
  sessionViewSchema,
  watchlistQuotesResponseSchema,
  settingsSchema,
  settingsUpdateSchema,
  strategyConfirmSchema,
  strategyProfileSchema,
  syncRequestSchema,
  type BrokerOverview,
  type Dashboard,
  type DiscoveryUniverse,
  type FinderBookmark,
  type FinderBookmarksResponse,
  type FinderCandidate,
  type FinderScanResult,
  type Portfolio,
  type ScanMorePriority,
  type SessionView,
  type WatchlistQuotesResponse,
  type SettingsUpdate,
  type SettingsView,
  type SmartScanPolicy,
  type SmartScanResult,
  type StrategyConfirm,
  type StrategyProfile,
  type SyncRequest,
  type ResearchRestore,
  type ResearchSessionList,
  type ResearchScanType,
  type ResearchUiPrefs,
  researchRestoreSchema,
  researchSessionListSchema,
  demoChainSchema,
  tradeJournalEntrySchema,
  tradeJournalListSchema,
  type DemoChain,
  type TradeJournalEntry,
  type TradeJournalWrite,
} from '@optionscout/shared';
import { z } from 'zod';

let csrfToken: string | null = null;

export function currentCsrfToken(): string | null {
  return csrfToken;
}

function rememberSession(session: SessionView): SessionView {
  csrfToken = session.csrfToken;
  return session;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  } catch {
    return `Local API request failed (${response.status}).`;
  }
  return `Local API request failed (${response.status}).`;
}

async function requestJson<T>(
  url: string,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } },
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('The local API returned an unexpected payload.');
  }
  return parsed.data;
}

export function fetchDashboard(): Promise<Dashboard> {
  return requestJson('/api/dashboard', dashboardSchema);
}

export function fetchBroker(): Promise<BrokerOverview> {
  return requestJson('/api/broker', brokerOverviewSchema);
}

export function fetchSettings(): Promise<SettingsView> {
  return requestJson('/api/settings', settingsSchema);
}

export async function fetchSession(): Promise<SessionView> {
  return rememberSession(await requestJson('/api/session', sessionViewSchema));
}

export async function setupOwner(passphrase: string, confirm: string): Promise<SessionView> {
  const response = await fetch('/api/owner/setup', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase, confirm }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  const parsed = sessionViewSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('The local API returned an unexpected payload.');
  }
  return rememberSession(parsed.data);
}

export function fetchWatchlistQuotes(symbols: readonly string[]): Promise<WatchlistQuotesResponse> {
  const query = symbols.map((symbol) => encodeURIComponent(symbol)).join(',');
  return requestJson(`/api/market-data/watchlist-quotes?symbols=${query}`, watchlistQuotesResponseSchema);
}

export async function login(passphrase: string): Promise<SessionView> {
  const response = await fetch('/api/session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  const parsed = sessionViewSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('The local API returned an unexpected payload.');
  }
  return rememberSession(parsed.data);
}

export async function logout(): Promise<SessionView> {
  const session = await requestJson('/api/session', sessionViewSchema, { method: 'DELETE' });
  return rememberSession(session);
}

export function saveSettings(update: SettingsUpdate): Promise<SettingsView> {
  const body = settingsUpdateSchema.parse(update);
  return requestJson('/api/settings', settingsSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function syncBroker(request: SyncRequest): Promise<BrokerOverview> {
  return requestJson('/api/broker/sync', brokerOverviewSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(syncRequestSchema.parse(request)),
  });
}

export function fetchPortfolio(): Promise<Portfolio> {
  return requestJson('/api/broker/portfolio', portfolioSchema);
}

export function confirmPortfolioStrategy(input: StrategyConfirm): Promise<Portfolio> {
  return requestJson('/api/broker/strategies', portfolioSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(strategyConfirmSchema.parse(input)),
  });
}

export function deletePortfolioStrategy(strategyId: string): Promise<Portfolio> {
  return requestJson(`/api/broker/strategies/${encodeURIComponent(strategyId)}`, portfolioSchema, { method: 'DELETE' });
}

export function selectBrokerAccount(accountId: string): Promise<BrokerOverview> {
  return requestJson('/api/broker/accounts/select', brokerOverviewSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
}

export function createFinderScan(request: z.input<typeof finderScanRequestSchema>): Promise<FinderScanResult> {
  return requestJson('/api/finder/scans', finderScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finderScanRequestSchema.parse(request)),
  });
}

export function fetchFinderScan(scanId: string): Promise<FinderScanResult> {
  return requestJson(`/api/finder/scans/${encodeURIComponent(scanId)}`, finderScanResultSchema);
}

export function cancelFinderScan(scanId: string): Promise<FinderScanResult> {
  return requestJson(`/api/finder/scans/${encodeURIComponent(scanId)}/cancel`, finderScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function scanFinderMore(scanId: string, count = 24, priority?: ScanMorePriority): Promise<FinderScanResult> {
  return requestJson(`/api/finder/scans/${encodeURIComponent(scanId)}/more`, finderScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finderScanMoreRequestSchema.parse({ count, priority })),
  });
}

export function retryFinderMissingData(scanId: string, count = 8): Promise<FinderScanResult> {
  return requestJson(`/api/finder/scans/${encodeURIComponent(scanId)}/retry-missing`, finderScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finderRetryMissingRequestSchema.parse({ count })),
  });
}

const strategyProfilesResponseSchema = z.object({
  profiles: z.array(strategyProfileSchema),
  defaultProfileId: z.string(),
});

export async function fetchStrategyProfiles(): Promise<{ profiles: StrategyProfile[]; defaultProfileId: string }> {
  return requestJson('/api/strategy-profiles', strategyProfilesResponseSchema);
}

export function fetchStrategyProfile(profileId: string): Promise<StrategyProfile> {
  return requestJson(`/api/strategy-profiles/${encodeURIComponent(profileId)}`, strategyProfileSchema);
}

export function createStrategyProfile(body: unknown): Promise<StrategyProfile> {
  return requestJson('/api/strategy-profiles', strategyProfileSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateStrategyProfile(profileId: string, body: unknown): Promise<StrategyProfile> {
  return requestJson(`/api/strategy-profiles/${encodeURIComponent(profileId)}`, strategyProfileSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function duplicateStrategyProfile(profileId: string, name?: string): Promise<StrategyProfile> {
  return requestJson(`/api/strategy-profiles/${encodeURIComponent(profileId)}/duplicate`, strategyProfileSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function saveStrategyProfileAs(profileId: string, name: string): Promise<StrategyProfile> {
  return requestJson(`/api/strategy-profiles/${encodeURIComponent(profileId)}/save-as`, strategyProfileSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function setDefaultStrategyProfile(profileId: string): Promise<StrategyProfile> {
  return requestJson(`/api/strategy-profiles/${encodeURIComponent(profileId)}/set-default`, strategyProfileSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function resetBuiltinStrategyTemplate(): Promise<StrategyProfile> {
  return requestJson('/api/strategy-profiles/sal-pmcc-deep-itm/reset', strategyProfileSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export async function deleteStrategyProfile(profileId: string): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/strategy-profiles/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
    body: JSON.stringify({ confirm: true }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
}

const savedIdeasSchema = z.object({
  ideas: z.array(z.object({
    id: z.string(),
    kind: z.enum(['pmcc-setup', 'leaps-idea', 'reviewed-pair']),
    underlying: z.string(),
    longOcc: z.string(),
    shortOcc: z.string().nullable(),
    quoteAsOf: z.string().nullable(),
    notes: z.string(),
    structureNote: z.string(),
    hypothetical: z.literal(true),
  })),
});

export type SavedIdea = z.infer<typeof savedIdeasSchema>['ideas'][number];

export function fetchSavedIdeas(): Promise<{ ideas: SavedIdea[] }> {
  return requestJson('/api/saved-ideas', savedIdeasSchema);
}

export function createSavedIdea(body: {
  underlying: string;
  longOcc: string;
  shortOcc?: string;
  notes?: string;
  quoteAsOf?: string | null;
  profileId?: string | null;
  profileRevision?: number | null;
  sessionId?: string | null;
}): Promise<SavedIdea> {
  return requestJson('/api/saved-ideas', savedIdeasSchema.shape.ideas.element, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function saveBrokerCredentials(body: {
  environment: 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<BrokerOverview> {
  return requestJson('/api/broker/credentials', brokerOverviewSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function disconnectBroker(): Promise<BrokerOverview> {
  return requestJson('/api/broker/disconnect', brokerOverviewSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

export function chooseBrokerAccount(choiceId: string): Promise<BrokerOverview> {
  return requestJson('/api/broker/accounts/choose', brokerOverviewSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choiceId }),
  });
}

export function testBrokerConnection(): Promise<BrokerOverview> {
  return requestJson('/api/broker/test-connection', brokerOverviewSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

export function fetchFinderBookmarks(): Promise<FinderBookmarksResponse> {
  return requestJson('/api/finder/bookmarks', finderBookmarksResponseSchema);
}

export function saveFinderBookmark(
  candidate: FinderCandidate,
  meta?: { profileId?: string; profileRevision?: number; scanId?: string },
): Promise<FinderBookmark> {
  return requestJson('/api/finder/bookmarks', finderBookmarkSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate, ...meta }),
  });
}

export async function deleteFinderBookmark(id: string): Promise<void> {
  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/finder/bookmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
}

const discoveryUniversesResponseSchema = z.object({
  curated: z.array(discoveryUniverseSchema),
  saved: z.array(discoveryUniverseSchema),
  bookmarkDerived: discoveryUniverseSchema.nullable(),
});

export async function fetchDiscoveryUniverses(): Promise<{
  curated: DiscoveryUniverse[];
  saved: DiscoveryUniverse[];
  bookmarkDerived: DiscoveryUniverse | null;
}> {
  return requestJson('/api/discovery/universes', discoveryUniversesResponseSchema);
}

export function createDiscoveryUniverse(input: {
  name: string;
  tickers: string[];
  sourceKind?: 'custom' | 'csv-import';
  sourceLabel?: string;
}): Promise<DiscoveryUniverse> {
  return requestJson('/api/discovery/universes', discoveryUniverseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function importDiscoveryUniverseCsv(name: string, csvText: string): Promise<DiscoveryUniverse> {
  return requestJson('/api/discovery/universes/csv', discoveryUniverseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, csvText }),
  });
}

export async function deleteDiscoveryUniverse(id: string): Promise<void> {
  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/discovery/universes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
}

export function fetchSmartScanPolicy(): Promise<SmartScanPolicy> {
  return requestJson('/api/finder/smart-scan-policy', smartScanPolicySchema);
}

export function createSmartScan(
  request: z.input<typeof smartScanRequestSchema>,
  options?: { wait?: boolean },
): Promise<SmartScanResult> {
  const wait = options?.wait === false ? '?wait=false' : '';
  return requestJson(`/api/finder/smart-scans${wait}`, smartScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export function fetchSmartScan(scanId: string): Promise<SmartScanResult> {
  return requestJson(`/api/finder/smart-scans/${encodeURIComponent(scanId)}`, smartScanResultSchema);
}

export function cancelSmartScan(scanId: string): Promise<SmartScanResult> {
  return requestJson(`/api/finder/smart-scans/${encodeURIComponent(scanId)}/cancel`, smartScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function scanSmartMore(
  scanId: string,
  body: z.input<typeof smartScanMoreRequestSchema> = {},
  options?: { wait?: boolean },
): Promise<SmartScanResult> {
  const wait = options?.wait === false ? '?wait=false' : '';
  return requestJson(`/api/finder/smart-scans/${encodeURIComponent(scanId)}/more${wait}`, smartScanResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function scanSmartNextCompanies(
  scanId: string,
  body: z.input<typeof smartScanNextCompaniesRequestSchema> = {},
  options?: { wait?: boolean },
): Promise<SmartScanResult> {
  const wait = options?.wait === false ? '?wait=false' : '';
  return requestJson(
    `/api/finder/smart-scans/${encodeURIComponent(scanId)}/next-companies${wait}`,
    smartScanResultSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smartScanNextCompaniesRequestSchema.parse(body)),
    },
  );
}

export function fetchResearchSessions(type: ResearchScanType, limit = 20): Promise<ResearchSessionList> {
  return requestJson(
    `/api/research-sessions?type=${encodeURIComponent(type)}&limit=${limit}`,
    researchSessionListSchema,
  );
}

export function fetchLatestResearchSession(type: ResearchScanType): Promise<ResearchRestore> {
  return requestJson(`/api/research-sessions/latest?type=${encodeURIComponent(type)}`, researchRestoreSchema);
}

export function fetchResearchSession(id: string): Promise<ResearchRestore> {
  return requestJson(`/api/research-sessions/${encodeURIComponent(id)}`, researchRestoreSchema);
}

export function patchResearchSessionUiPrefs(
  id: string,
  body: { uiPrefs: ResearchUiPrefs },
): Promise<{ ok: boolean }> {
  return requestJson(
    `/api/research-sessions/${encodeURIComponent(id)}/ui-prefs`,
    z.object({ ok: z.boolean() }),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export async function deleteResearchSession(id: string): Promise<void> {
  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/research-sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
}

const holdingsPreviewResponseSchema = z
  .object({
    headers: z.array(z.string()),
    headerLine: z.number(),
    mapping: z.record(z.string(), z.enum(['ticker', 'name', 'sector', 'weight', 'assetClass', 'ignore'])),
    rows: z.array(
      z
        .object({
          line: z.number(),
          rawTicker: z.string(),
          ticker: z.string().nullable(),
          name: z.string().nullable(),
          sector: z.string().nullable(),
          weight: z.string().nullable(),
          weightPercent: z.string().nullable().optional(),
          assetClass: z.string().nullable(),
          status: z.enum(['equity', 'duplicate', 'invalid', 'non-equity', 'cash', 'ignored']),
          reason: z.string(),
        })
        .passthrough(),
    ),
    rowsTruncated: z.boolean(),
    uniqueEquityTickers: z.array(z.string()),
    counts: z
      .object({
        parsed: z.number(),
        equity: z.number(),
        duplicate: z.number(),
        invalid: z.number(),
        nonEquity: z.number(),
        cash: z.number(),
        ignored: z.number(),
        normalizedShareClass: z.number(),
      })
      .passthrough(),
    detectedEffectiveDate: z.string().nullable(),
    contentHash: z.string(),
    truncated: z.boolean(),
    weightReading: z.string().optional(),
    weightReadingReason: z.string().optional(),
  })
  .passthrough();

export type HoldingsPreviewResponse = z.infer<typeof holdingsPreviewResponseSchema>;
export type HoldingsColumnMapping = Partial<Record<HoldingsMappableRole, string>>;

export function previewHoldingsCsvImport(
  csvText: string,
  mapping?: HoldingsColumnMapping,
  weightChoice: 'auto' | 'percentage-points' | 'decimal-fraction' = 'auto',
): Promise<HoldingsPreviewResponse> {
  return requestJson('/api/discovery/universes/holdings/preview', holdingsPreviewResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      csvText,
      ...(mapping && Object.keys(mapping).length > 0 ? { mapping } : {}),
      weightChoice,
    }),
  });
}

export function commitHoldingsCsvImport(body: {
  name: string;
  universeId?: string | null;
  fundTicker?: string | null;
  provider?: string;
  holdingsEffectiveDate: string;
  csvText: string;
  mapping?: HoldingsColumnMapping;
  contentHash: string;
  weightChoice?: 'auto' | 'percentage-points' | 'decimal-fraction';
}): Promise<{ universeId: string; versionId: string; version: number; unchanged: boolean; notice: string }> {
  return requestJson(
    '/api/discovery/universes/holdings',
    z
      .object({
        universeId: z.string(),
        versionId: z.string(),
        version: z.number(),
        unchanged: z.boolean(),
        notice: z.string(),
      })
      .passthrough(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        body.mapping && Object.keys(body.mapping).length > 0 ? body : { ...body, mapping: undefined },
      ),
    },
  );
}

export function fetchDemoChain(): Promise<DemoChain> {
  return requestJson('/api/research/demo-chain', demoChainSchema);
}

export function fetchTradeJournal(): Promise<{ entries: TradeJournalEntry[]; summary: { count: number; wins: number; losses: number; open: number; scratch: number; winRate: string | null; totalEstimatedPnl: string } }> {
  return requestJson('/api/journal', tradeJournalListSchema);
}

export function createTradeJournalEntry(body: TradeJournalWrite): Promise<TradeJournalEntry> {
  return requestJson('/api/journal', tradeJournalEntrySchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateTradeJournalEntry(id: string, body: TradeJournalWrite): Promise<TradeJournalEntry> {
  return requestJson(`/api/journal/${encodeURIComponent(id)}`, tradeJournalEntrySchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteTradeJournalEntry(id: string): Promise<void> {
  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: 'DELETE', headers, credentials: 'include' });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export function retrySmartScanCompanies(
  scanId: string,
  body: z.input<typeof smartScanRetryCompaniesRequestSchema> = {},
  options?: { wait?: boolean },
): Promise<SmartScanResult> {
  const wait = options?.wait === false ? '?wait=false' : '';
  return requestJson(
    `/api/finder/smart-scans/${encodeURIComponent(scanId)}/retry-companies${wait}`,
    smartScanResultSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smartScanRetryCompaniesRequestSchema.parse(body)),
    },
  );
}
