import {
  accountSelectionSchema,
  brokerOverviewSchema,
  effectiveLiveScanEnabled,
  finderBookmarkCreateSchema,
  finderBookmarkSchema,
  finderBookmarksResponseSchema,
  finderRetryMissingRequestSchema,
  finderScanMoreRequestSchema,
  finderScanResultSchema,
  buildSmartScanPolicy,
  HoldingsPreviewError,
  holdingsCommitRequestSchema,
  holdingsPreviewRequestSchema,
  normalizeTickerList,
  smartScanMoreRequestSchema,
  smartScanNextCompaniesRequestSchema,
  smartScanRequestSchema,
  smartScanResultSchema,
  smartScanRetryCompaniesRequestSchema,
  portfolioSchema,
  strategyConfirmSchema,
  importedPositionSchema,
  importedTransactionSchema,
  loginRequestSchema,
  quoteSnapshotSchema,
  sessionViewSchema,
  syncRequestSchema,
  researchSessionListSchema,
  researchUiPrefsPatchSchema,
  researchRestoreSchema,
} from '@optionscout/shared';
import type { Express, Request, Response } from 'express';
import { checkOwnerPassphrase, ownerIsConfigured } from './auth/owner.js';
import { loginIsLocked, recordLoginAttempt } from './auth/rate-limit.js';
import {
  assertCsrf,
  clearSessionCookie,
  createOwnerSession,
  destroySession,
  findOwnerSession,
  readSessionCookie,
  rotateCsrf,
  writeSessionCookie,
  type OwnerSession,
} from './auth/session.js';
import { authorizeSync } from './brokerage/actor.js';
import { brokerageFailureMessage, ScheduledSyncDisabledError, SyncInputError, TastytradeError } from './brokerage/errors.js';
import { buildBrokerOverview, listImportedPositions, listImportedTransactions } from './brokerage/status.js';
import { discoverAccounts, selectBrokerAccount, syncPositions, syncQuotes, syncTransactions } from './brokerage/sync.js';
import { buildPortfolio, confirmStrategy, deleteStrategy } from './accounting/portfolio.js';
import type { AppContext } from './context.js';
import { quoteSnapshots } from './db/schema.js';
import { deleteFinderBookmark, listFinderBookmarks, saveFinderBookmark } from './finder/bookmarks.js';
import {
  cancelFinderScan,
  continueFinderScan,
  getFinderScan,
  retryFinderMissingData,
  startFinderScan,
  waitForFinderScan,
  type FinderScanDeps,
} from './finder/scan.js';
import {
  cancelSmartScan,
  continueSmartScan,
  getSmartScan,
  retrySmartScanCompanies,
  scanNextCompanies,
  startSmartScan,
  waitForSmartScan,
  type SmartScanDeps,
} from './finder/smart-scan.js';
import {
  ResearchClaimError,
  ResearchPersistenceError,
  deleteResearchSession,
  getLatestResearchSessionId,
  listResearchSessions,
  loadDiscoverRestore,
  loadFinderRestore,
  patchResearchUiPrefs,
} from './finder/research-sessions.js';
import {
  UniverseError,
  createUniverse,
  createUniverseFromCsv,
  deleteUniverse,
  listAllUniverses,
  resolveScanUniverse,
} from './finder/universes.js';
import { commitHoldingsImport, previewHoldingsImport } from './finder/holdings-import.js';
import { assertLoopbackRequest, HttpError } from './http.js';
import { readSettings, updateSettings } from './services/settings.js';
import {
  StrategyProfileError,
  createStrategyProfile,
  deleteStrategyProfile,
  duplicateStrategyProfile,
  listStrategyProfiles,
  readDefaultStrategyProfile,
  readStrategyProfile,
  resetBuiltinTemplate,
  saveStrategyProfile,
  saveStrategyProfileAs,
  setDefaultStrategyProfile,
} from './strategy/profiles.js';
import { runDxlinkDiagnostic } from './marketdata/diagnostic.js';
import {
  CredentialInputError,
  accountFingerprint,
  disconnectBroker,
  importNeedsDecision,
  rememberImportFingerprint,
  rememberPendingFingerprint,
  saveManagedCredentials,
  validateCredentialInput,
} from './brokerage/connection.js';
import { refreshBrokerConnection } from './context.js';
import { openLiveDxlinkSocket } from './marketdata/live-socket.js';
import type { SettingsUpdate } from '@optionscout/shared';
import { ZodError } from 'zod';

function sessionFrom(req: Request, context: AppContext): OwnerSession | null {
  return findOwnerSession(context.database.db, readSessionCookie(req.get('cookie')));
}

export function requireMutationSession(req: Request, context: AppContext): OwnerSession | null {
  assertLoopbackRequest(req, true);
  const token = readSessionCookie(req.get('cookie'));
  if (!token) {
    return null;
  }
  const session = findOwnerSession(context.database.db, token);
  if (!session) {
    throw new HttpError(401, 'Sign in required.');
  }
  assertCsrf(req, session);
  return session;
}

function requireSession(req: Request, context: AppContext): OwnerSession {
  const session = sessionFrom(req, context);
  if (!session) {
    throw new HttpError(401, 'Sign in required.');
  }
  return session;
}

function settingsView(context: AppContext) {
  return readSettings(context.database.db, context.config.finderLiveScan, context.config.smartScanLive);
}

function overview(context: AppContext, session: OwnerSession | null) {
  const settings = settingsView(context);
  return brokerOverviewSchema.parse(
    buildBrokerOverview({
      db: context.database.db,
      config: context.config,
      runtime: context.brokerRuntime,
      authenticated: Boolean(session),
      ownerConfigured: ownerIsConfigured(context.database.db),
      portfolioView: settings.portfolioView,
      connection: context.brokerConnection,
    }),
  );
}

function selectedAccountId(context: AppContext): string {
  const overviewBody = overview(context, { id: 'local', csrfHash: '', expiresAt: new Date(Date.now() + 1000).toISOString() });
  const selected = overviewBody.accounts.find((account) => account.selected);
  if (!selected) {
    throw new HttpError(409, 'Select an account before reading imported brokerage data.');
  }
  return selected.id;
}

function sendKnownError(res: Response, error: unknown): boolean {
  if (error instanceof CredentialInputError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  if (error instanceof ScheduledSyncDisabledError || error instanceof SyncInputError) {
    res.status(error instanceof SyncInputError ? error.status : 409).json({ error: error.message });
    return true;
  }
  if (error instanceof TastytradeError) {
    const status = error.status === 429 ? 429 : error.status >= 500 ? 503 : error.status === 403 ? 403 : 502;
    res.status(status).json({ error: brokerageFailureMessage(error.status) });
    return true;
  }
  if (error instanceof UniverseError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  if (error instanceof HoldingsPreviewError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof ResearchClaimError) {
    res.status(error.reason === 'not-found' ? 404 : 409).json({ error: error.message });
    return true;
  }
  if (error instanceof ResearchPersistenceError) {
    res.status(503).json({ error: error.message });
    return true;
  }
  return false;
}

async function accountNumbers(client: NonNullable<AppContext['brokerage']>): Promise<string[]> {
  const body = await client.getJson('/customers/me/accounts');
  const items = body && typeof body === 'object' && Array.isArray((body as { data?: { items?: unknown[] } }).data?.items)
    ? (body as { data: { items: unknown[] } }).data.items
    : [];
  const numbers: string[] = [];
  for (const item of items) {
    const account = item && typeof item === 'object' ? (item as { account?: { 'account-number'?: unknown } }).account : undefined;
    const number = account?.['account-number'];
    if (typeof number === 'string' && number.trim()) numbers.push(number.trim());
  }
  return numbers;
}

async function runSync(
  context: AppContext,
  session: OwnerSession,
  body: { transactions?: { mode: 'recent' | 'backfill'; startDate?: string }; acknowledgeAccountChange?: 'keep-history' },
): Promise<void> {
  if (context.brokerConnection.hardDisabled) {
    throw new HttpError(409, 'TASTYTRADE_DISABLE_LIVE is on. No brokerage request will be sent.');
  }
  if (!context.brokerConnection.providerAllowed || !context.brokerage) {
    throw new HttpError(409, 'Live brokerage access is disabled.');
  }
  const fingerprint = accountFingerprint(context.brokerConnection.environment, await accountNumbers(context.brokerage));
  if (importNeedsDecision(context.database.db, fingerprint) && body.acknowledgeAccountChange !== 'keep-history') {
    rememberPendingFingerprint(context.database.db, fingerprint);
    throw new HttpError(409, 'This connection is for a different brokerage account or environment. Existing history was kept. Import again only after choosing to keep that history.');
  }
  rememberImportFingerprint(context.database.db, fingerprint);
  const actor = { type: 'session' as const, sessionId: session.id };
  authorizeSync(actor, context.config.scheduledSyncEnabled);
  const client = context.brokerage;
  try {
    await discoverAccounts(context.database.db, client, actor, context.config.scheduledSyncEnabled);
    await syncPositions(context.database.db, client, actor, context.config.scheduledSyncEnabled);
    await syncTransactions(context.database.db, client, actor, {
      lookbackDays: context.config.transactionLookbackDays,
      scheduledSyncEnabled: context.config.scheduledSyncEnabled,
      transactions: body.transactions,
    });
    await syncQuotes(context.database.db, client, actor, context.config.scheduledSyncEnabled);
    context.brokerRuntime.connectedThisProcess = true;
    context.brokerRuntime.lastError = null;
  } catch (error) {
    if (!(error instanceof SyncInputError)) {
      context.brokerRuntime.connectedThisProcess = false;
      context.brokerRuntime.lastError = error instanceof TastytradeError ? brokerageFailureMessage(error.status) : 'The brokerage request failed.';
    }
    throw error;
  }
}

/** Default POST waits until the operation finishes. `wait=false` returns the running session immediately. */
export function respondWithoutWaiting(query: Request['query']): boolean {
  const wait = query.wait;
  return wait === 'false' || wait === '0';
}

export function registerRoutes(app: Express, context: AppContext): void {
  app.get('/api/session', (req, res, next) => {
    try {
      const session = sessionFrom(req, context);
      const csrfToken = session ? rotateCsrf(context.database.db, session.id) : null;
      res.json(
        sessionViewSchema.parse({
          authenticated: Boolean(session),
          ownerConfigured: ownerIsConfigured(context.database.db),
          expiresAt: session?.expiresAt ?? null,
          csrfToken,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/session', (req, res, next) => {
    try {
      assertLoopbackRequest(req, true);
      if (!ownerIsConfigured(context.database.db)) {
        res.status(409).json({ error: 'Run owner-setup before signing in.' });
        return;
      }
      if (loginIsLocked(context.database.db)) {
        res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
        return;
      }
      const parsed = loginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Sign-in failed.' });
        return;
      }
      if (!checkOwnerPassphrase(context.database.db, parsed.data.passphrase)) {
        recordLoginAttempt(context.database.db, false);
        res.status(401).json({ error: 'Sign-in failed.' });
        return;
      }
      recordLoginAttempt(context.database.db, true);
      const created = createOwnerSession(context.database.db);
      writeSessionCookie(res, created.token);
      res.json(
        sessionViewSchema.parse({
          authenticated: true,
          ownerConfigured: true,
          expiresAt: created.expiresAt,
          csrfToken: created.csrfToken,
        }),
      );
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/session', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      destroySession(context.database.db, session.id);
      clearSessionCookie(res);
      res.json(sessionViewSchema.parse({ authenticated: false, ownerConfigured: ownerIsConfigured(context.database.db), expiresAt: null, csrfToken: null }));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/broker', (req, res, next) => {
    try {
      res.json(overview(context, sessionFrom(req, context)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/broker/sync', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      const parsed = syncRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Sync request rejected.' });
        return;
      }
      if (parsed.data.transactions?.mode === 'backfill' && !parsed.data.transactions.startDate) {
        res.status(400).json({ error: 'A backfill start date is required.' });
        return;
      }
      await runSync(context, session, parsed.data);
      res.json(overview(context, session));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/broker/credentials', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const saved = saveManagedCredentials(context.database.db, context.config.databasePath, validateCredentialInput(req.body ?? {}));
      const active = refreshBrokerConnection(context);
      active.permissionWarning = saved.permissionWarning;
      const body = overview(context, session);
      const serialized = JSON.stringify(body);
      for (const secret of [req.body?.clientSecret, req.body?.refreshToken, req.body?.clientId]) {
        if (typeof secret === 'string' && secret && serialized.includes(secret)) {
          throw new HttpError(500, 'Credential response was withheld.');
        }
      }
      res.json({ ...body, connection: { ...body.connection, permissionWarning: saved.permissionWarning } });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/broker/disconnect', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      disconnectBroker(context.database.db, context.config.databasePath);
      refreshBrokerConnection(context);
      const body = overview(context, session);
      res.json({
        ...body,
        connection: {
          ...body.connection,
          message: `${body.connection.message} Revoking the grant at tastytrade is a separate action.`,
        },
      });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/broker/test-connection', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      if (context.brokerConnection.hardDisabled) {
        throw new HttpError(409, 'TASTYTRADE_DISABLE_LIVE is on. Test Connection will not contact tastytrade.');
      }
      if (!context.brokerConnection.providerAllowed || !context.brokerage) {
        throw new HttpError(409, 'Read-only brokerage access is not armed. Saving credentials does not contact tastytrade by itself.');
      }
      const numbers = await accountNumbers(context.brokerage);
      if (numbers.length === 0) {
        context.brokerRuntime.connectedThisProcess = false;
        context.brokerRuntime.lastError = 'The brokerage did not confirm an account.';
        throw new HttpError(502, 'The brokerage did not confirm an account.');
      }
      const fingerprint = accountFingerprint(context.brokerConnection.environment, numbers);
      rememberPendingFingerprint(context.database.db, fingerprint);
      context.brokerRuntime.connectedThisProcess = true;
      context.brokerRuntime.lastError = null;
      const body = overview(context, session);
      res.json({
        ...body,
        connection: {
          ...body.connection,
          state: 'connected',
          accountChangePending: importNeedsDecision(context.database.db, fingerprint),
          message: importNeedsDecision(context.database.db, fingerprint)
            ? 'Connected. This grant sees a different account or environment than the imported history. Nothing was imported.'
            : 'Connected. Read-only access was confirmed. Nothing was imported.',
        },
      });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/broker/accounts/select', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      const parsed = accountSelectionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Account selection rejected.' });
        return;
      }
      selectBrokerAccount(context.database.db, parsed.data.accountId);
      res.json(overview(context, session));
    } catch (error) {
      if (error instanceof Error && error.message === 'That account is not available.') {
        res.status(404).json({ error: 'That account is not available.' });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/broker/portfolio', (req, res, next) => {
    try {
      requireSession(req, context);
      res.json(portfolioSchema.parse(buildPortfolio(context.database.db, selectedAccountId(context))));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/broker/strategies', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const parsed = strategyConfirmSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Strategy confirmation rejected.' });
        return;
      }
      res.json(portfolioSchema.parse(confirmStrategy(context.database.db, selectedAccountId(context), parsed.data)));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/broker/strategies/:id', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      res.json(portfolioSchema.parse(deleteStrategy(context.database.db, selectedAccountId(context), String(req.params.id))));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/broker/positions', (req, res, next) => {
    try {
      requireSession(req, context);
      const rows = listImportedPositions(context.database.db, selectedAccountId(context));
      res.json(rows.map((row) => importedPositionSchema.parse(row)));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/broker/transactions', (req, res, next) => {
    try {
      requireSession(req, context);
      const rows = listImportedTransactions(context.database.db, selectedAccountId(context));
      res.json(rows.map((row) => importedTransactionSchema.parse(row)));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/broker/quotes', (req, res, next) => {
    try {
      requireSession(req, context);
      const rows = context.database.db.select().from(quoteSnapshots).all();
      res.json(
        rows
          .filter((row) => row.symbol !== '')
          .map((row) =>
            quoteSnapshotSchema.parse({
              symbol: row.symbol,
              instrumentType: row.instrumentType,
              bid: row.bid,
              ask: row.ask,
              mid: row.mid,
              mark: row.mark,
              lastPrice: row.lastPrice,
              asOf: row.quoteAsOf,
              fetchedAt: row.fetchedAt,
              freshness: row.freshness,
              entitlement: row.entitlement,
              source: 'tastytrade',
              message: row.message,
            }),
          ),
      );
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/market-data/stream', (req, res, next) => {
    try {
      requireSession(req, context);
      res.json({
        state: 'not-connected',
        transport: 'dxlink',
        implemented: true,
        liveEnabled: false,
        detail: context.config.dxlinkLiveDiagnostic
          ? 'DXLink live diagnostic is armed. Startup does not open a socket. REST snapshots remain the fallback.'
          : 'DXLink protocol is implemented. The live diagnostic switch is off, and startup does not open a socket. REST snapshots remain the fallback.',
      });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/market-data/stream', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      if (settingsView(context).portfolioView === 'demo') {
        res.status(409).json({ error: 'Streaming is disabled in Demo Mode.' });
        return;
      }
      res.status(409).json({ error: 'Live DXLink is disabled until an approved diagnostic.' });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/market-data/diagnostic', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      if (settingsView(context).portfolioView === 'demo') {
        res.status(409).json({ error: 'Streaming is disabled in Demo Mode.' });
        return;
      }
      if (!context.config.dxlinkLiveDiagnostic || !context.brokerage) {
        res.status(409).json({ error: 'DXLink live diagnostic is disabled.' });
        return;
      }
      const report = await runDxlinkDiagnostic({
        enabled: true,
        db: context.database.db,
        client: context.brokerage,
        connect: (url) => openLiveDxlinkSocket(url),
      });
      res.json(report);
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/strategy-profiles', (req, res, next) => {
    try {
      requireSession(req, context);
      res.json({
        profiles: listStrategyProfiles(context.database.db),
        defaultProfileId: readDefaultStrategyProfile(context.database.db).id,
      });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/strategy-profiles/:profileId', (req, res, next) => {
    try {
      requireSession(req, context);
      res.json(readStrategyProfile(context.database.db, String(req.params.profileId)));
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/strategy-profiles', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const created = createStrategyProfile(context.database.db, req.body);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? 'The strategy profile is invalid.' });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.put('/api/strategy-profiles/:profileId', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      res.json(saveStrategyProfile(context.database.db, String(req.params.profileId), req.body));
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? 'The strategy profile is invalid.' });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  /** Legacy alias — edits the built-in Sal PMCC template id (creates a new revision). */
  app.put('/api/strategy-profiles/sal-pmcc-deep-itm', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      res.json(saveStrategyProfile(context.database.db, 'sal-pmcc-deep-itm', req.body));
    } catch (error) {
      if (error instanceof StrategyProfileError || error instanceof ZodError) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'The strategy profile is invalid.' });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/strategy-profiles/:profileId/duplicate', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
      res.status(201).json(duplicateStrategyProfile(context.database.db, String(req.params.profileId), name));
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/strategy-profiles/:profileId/save-as', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'Save As requires a new strategy name.' });
        return;
      }
      res.status(201).json(saveStrategyProfileAs(context.database.db, String(req.params.profileId), name));
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/strategy-profiles/:profileId/set-default', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      res.json(setDefaultStrategyProfile(context.database.db, String(req.params.profileId)));
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/strategy-profiles/sal-pmcc-deep-itm/reset', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      res.json(resetBuiltinTemplate(context.database.db));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/strategy-profiles/:profileId', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const confirmed = req.body?.confirm === true || req.query.confirm === 'true';
      deleteStrategyProfile(context.database.db, String(req.params.profileId), confirmed);
      res.status(204).end();
    } catch (error) {
      if (error instanceof StrategyProfileError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/scans', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      const started = startFinderScan(finderDeps(context, settingsView(context)), req.body);
      // Demo and mocked scans finish quickly; await so the first response is complete.
      const finished = (await waitForFinderScan(started.scanId)) ?? started;
      res.status(201).json(finderScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        const deltaIssue = error.issues.find((issue) => issue.path.includes('minLongDelta'));
        res.status(400).json({
          error: deltaIssue?.message ?? 'The finder scan request is invalid.',
        });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/finder/scans/:scanId', (req, res, next) => {
    try {
      requireSession(req, context);
      const result = getFinderScan(String(req.params.scanId), context.database.sqlite);
      if (!result) {
        throw new HttpError(404, 'Finder scan was not found.');
      }
      res.json(finderScanResultSchema.parse(result));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/scans/:scanId/cancel', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      const result = cancelFinderScan(String(req.params.scanId));
      if (!result) {
        throw new HttpError(404, 'Finder scan was not found.');
      }
      res.json(finderScanResultSchema.parse(result));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/scans/:scanId/more', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      finderScanMoreRequestSchema.parse(req.body ?? {});
      const started = continueFinderScan(
        String(req.params.scanId),
        req.body ?? {},
        finderDeps(context, settingsView(context)),
      );
      const finished = (await waitForFinderScan(started.scanId)) ?? started;
      res.json(finderScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'The Scan More request is invalid.' });
        return;
      }
      if (error instanceof Error && /not found/i.test(error.message)) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && /already|cannot continue|already been evaluated|was created with/i.test(error.message)) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/scans/:scanId/retry-missing', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      finderRetryMissingRequestSchema.parse(req.body ?? {});
      const started = retryFinderMissingData(
        String(req.params.scanId),
        req.body ?? {},
        finderDeps(context, settingsView(context)),
      );
      const finished = (await waitForFinderScan(started.scanId)) ?? started;
      res.json(finderScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'The Retry Missing Data request is invalid.' });
        return;
      }
      if (error instanceof Error && /not found/i.test(error.message)) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && /already|cannot retry/i.test(error.message)) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/finder/bookmarks', (req, res, next) => {
    try {
      requireSession(req, context);
      res.json(finderBookmarksResponseSchema.parse(listFinderBookmarks(context.database.db)));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/bookmarks', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      const body = finderBookmarkCreateSchema.parse(req.body);
      const saved = saveFinderBookmark(context.database.db, body.candidate, undefined, {
        profileId: body.profileId,
        profileRevision: body.profileRevision,
        scanId: body.scanId,
      });
      res.status(201).json(finderBookmarkSchema.parse(saved));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'The bookmark payload is invalid.' });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/finder/bookmarks/:id', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) {
        throw new HttpError(401, 'Sign in required.');
      }
      const removed = deleteFinderBookmark(context.database.db, String(req.params.id));
      if (!removed) {
        throw new HttpError(404, 'Bookmark was not found.');
      }
      res.status(204).end();
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/discovery/universes', (req, res, next) => {
    try {
      requireSession(req, context);
      res.json(listAllUniverses(context.database.db));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/discovery/universes', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const name = String(req.body?.name ?? '').trim();
      const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers.map(String) : [];
      if (!name) {
        res.status(400).json({ error: 'A universe name is required.' });
        return;
      }
      const saved = createUniverse(context.database.db, {
        name,
        tickers,
        sourceKind: req.body?.sourceKind === 'csv-import' ? 'csv-import' : 'custom',
        sourceLabel: typeof req.body?.sourceLabel === 'string' ? req.body.sourceLabel : undefined,
      });
      res.status(201).json(saved);
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/discovery/universes/holdings/preview', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const parsed = holdingsPreviewRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'The holdings preview request is invalid.' });
        return;
      }
      res.json(previewHoldingsImport(parsed.data.csvText, parsed.data.mapping ?? {}, parsed.data.weightChoice));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/discovery/universes/holdings', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const parsed = holdingsCommitRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'The holdings import request is invalid.' });
        return;
      }
      const saved = commitHoldingsImport(context.database.db, parsed.data);
      res.status(saved.unchanged ? 200 : 201).json({
        universeId: saved.universeId,
        versionId: saved.versionId,
        version: saved.version,
        unchanged: saved.unchanged,
        counts: saved.preview.counts,
        notice: saved.unchanged
          ? `This file matches the current version (v${saved.version}); no new version was created.`
          : `Saved as immutable version v${saved.version}. Existing research sessions keep the version they started with. Option support is not implied.`,
      });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/discovery/universes/csv', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const name = String(req.body?.name ?? '').trim() || 'Imported ticker list';
      const csvText = String(req.body?.csvText ?? '');
      const saved = createUniverseFromCsv(context.database.db, name, csvText);
      res.status(201).json(saved);
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/discovery/universes/:id', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const removed = deleteUniverse(context.database.db, String(req.params.id));
      if (!removed) throw new HttpError(404, 'Saved universe was not found (curated lists cannot be deleted).');
      res.status(204).end();
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  /** Read-only Smart Scan policy — no secrets; available before sign-in so UI can guide selection. */
  app.get('/api/finder/smart-scan-policy', (req, res, next) => {
    try {
      const settings = settingsView(context);
      const liveScanEnabled = effectiveLiveScanEnabled(
        context.config.finderLiveScan,
        settings.finderOnDemandSearchEnabled,
      );
      res.json(
        buildSmartScanPolicy({
          smartScanLive: context.config.smartScanLive,
          mode: settings.smartScanMode,
          liveScanEnabled,
          portfolioView: settings.portfolioView,
        }),
      );
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/smart-scans', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const settings = settingsView(context);
      const parsed = smartScanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'The Smart Scan request is invalid.' });
        return;
      }
      const universe =
        parsed.data.universeId || parsed.data.universeVersionId
          ? resolveScanUniverse(context.database.db, {
              universeId: parsed.data.universeId,
              universeVersionId: parsed.data.universeVersionId,
            })
          : null;
      const started = startSmartScan(smartScanDeps(context, settings), parsed.data, universe);
      const finished = respondWithoutWaiting(req.query) ? started : ((await waitForSmartScan(started.scanId)) ?? started);
      res.status(201).json(smartScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: error.issues[0]?.message ?? 'The Smart Scan request is invalid.' });
        return;
      }
      if (
        error instanceof Error &&
        /at most|valid ticker|not available|not enabled|restricted to|cannot exceed|requires/i.test(error.message)
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/finder/smart-scans/:scanId', (req, res, next) => {
    try {
      requireSession(req, context);
      const result = getSmartScan(String(req.params.scanId), context.database.sqlite);
      if (!result) {
        throw new HttpError(404, 'Smart Scan session was not found. Saved sessions are listed under Recent Searches.');
      }
      res.json(smartScanResultSchema.parse(result));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  /** Research session library — restore is display-only (no brokerage). */
  app.get('/api/research-sessions', (req, res, next) => {
    try {
      requireSession(req, context);
      const type = String(req.query.type ?? 'discover');
      if (type !== 'discover' && type !== 'finder') {
        res.status(400).json({ error: 'type must be discover or finder.' });
        return;
      }
      const limit = Number(req.query.limit ?? 20);
      const sessions = listResearchSessions(context.database.sqlite, type, limit);
      res.json(researchSessionListSchema.parse({ sessions }));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/research-sessions/latest', (req, res, next) => {
    try {
      requireSession(req, context);
      const type = String(req.query.type ?? 'discover');
      if (type !== 'discover' && type !== 'finder') {
        res.status(400).json({ error: 'type must be discover or finder.' });
        return;
      }
      const id = getLatestResearchSessionId(context.database.sqlite, type);
      if (!id) {
        res.status(404).json({ error: 'No saved research session yet.' });
        return;
      }
      const restored =
        type === 'discover'
          ? loadDiscoverRestore(context.database.sqlite, id)
          : loadFinderRestore(context.database.sqlite, id);
      if (!restored) {
        res.status(404).json({ error: 'Saved research session was not found.' });
        return;
      }
      res.json(researchRestoreSchema.parse(restored));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.get('/api/research-sessions/:id', (req, res, next) => {
    try {
      requireSession(req, context);
      const id = String(req.params.id);
      const restored =
        loadDiscoverRestore(context.database.sqlite, id) ?? loadFinderRestore(context.database.sqlite, id);
      if (!restored) throw new HttpError(404, 'Saved research session was not found.');
      res.json(researchRestoreSchema.parse(restored));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.patch('/api/research-sessions/:id/ui-prefs', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const parsed = researchUiPrefsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid UI preferences payload.' });
        return;
      }
      const ok = patchResearchUiPrefs(context.database.sqlite, String(req.params.id), parsed.data.uiPrefs);
      if (!ok) throw new HttpError(404, 'Saved research session was not found.');
      res.json({ ok: true });
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.delete('/api/research-sessions/:id', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const ok = deleteResearchSession(context.database.sqlite, String(req.params.id));
      if (!ok) throw new HttpError(404, 'Saved research session was not found.');
      res.status(204).end();
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/smart-scans/:scanId/cancel', (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      const result = cancelSmartScan(String(req.params.scanId));
      if (!result) throw new HttpError(404, 'Smart Scan session was not found.');
      res.json(smartScanResultSchema.parse(result));
    } catch (error) {
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/smart-scans/:scanId/more', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      smartScanMoreRequestSchema.parse(req.body ?? {});
      const started = continueSmartScan(
        String(req.params.scanId),
        req.body ?? {},
        smartScanDeps(context, settingsView(context)),
      );
      const finished = respondWithoutWaiting(req.query) ? started : ((await waitForSmartScan(started.scanId)) ?? started);
      res.json(smartScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'The Smart Scan More request is invalid.' });
        return;
      }
      if (error instanceof Error && /not found|cannot continue|already running/i.test(error.message)) {
        const status = /not found/i.test(error.message) ? 404 : 409;
        res.status(status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  app.post('/api/finder/smart-scans/:scanId/next-companies', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      smartScanNextCompaniesRequestSchema.parse(req.body ?? {});
      const started = scanNextCompanies(
        String(req.params.scanId),
        req.body ?? {},
        smartScanDeps(context, settingsView(context)),
      );
      const finished = respondWithoutWaiting(req.query) ? started : ((await waitForSmartScan(started.scanId)) ?? started);
      res.json(smartScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'The Scan Next Companies request is invalid.' });
        return;
      }
      if (
        error instanceof Error &&
        /not found|cannot continue|already running|No unprocessed|restricted to|at most/i.test(error.message)
      ) {
        const status = /not found/i.test(error.message) ? 404 : /restricted to|at most/i.test(error.message) ? 400 : 409;
        res.status(status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });

  /** Re-attempt companies whose last attempt errored, was rate-limited, or was interrupted. Cursor unchanged. */
  app.post('/api/finder/smart-scans/:scanId/retry-companies', async (req, res, next) => {
    try {
      const session = requireMutationSession(req, context);
      if (!session) throw new HttpError(401, 'Sign in required.');
      smartScanRetryCompaniesRequestSchema.parse(req.body ?? {});
      const started = retrySmartScanCompanies(
        String(req.params.scanId),
        req.body ?? {},
        smartScanDeps(context, settingsView(context)),
      );
      const finished = respondWithoutWaiting(req.query) ? started : ((await waitForSmartScan(started.scanId)) ?? started);
      res.json(smartScanResultSchema.parse(finished));
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'The Retry Companies request is invalid.' });
        return;
      }
      if (error instanceof Error && /not found|already running|No retryable|restricted to/i.test(error.message)) {
        const status = /not found/i.test(error.message) ? 404 : /restricted to/i.test(error.message) ? 400 : 409;
        res.status(status).json({ error: error.message });
        return;
      }
      if (!sendKnownError(res, error)) next(error);
    }
  });
}

function finderDeps(context: AppContext, settings: ReturnType<typeof settingsView>): FinderScanDeps {
  return {
    liveScanEnabled: effectiveLiveScanEnabled(context.config.finderLiveScan, settings.finderOnDemandSearchEnabled),
    brokerage: context.brokerage,
    portfolioView: settings.portfolioView,
    readProfile: (profileId) => readStrategyProfile(context.database.db, profileId),
    database: context.database.db,
    persistSqlite: context.database.sqlite,
    ...context.finderTestDeps,
  };
}

function smartScanDeps(context: AppContext, settings: ReturnType<typeof settingsView>): SmartScanDeps {
  return {
    smartScanLiveEnabled: context.config.smartScanLive,
    liveScanEnabled: effectiveLiveScanEnabled(context.config.finderLiveScan, settings.finderOnDemandSearchEnabled),
    portfolioView: settings.portfolioView,
    smartScanMode: settings.smartScanMode,
    brokerage: context.brokerage,
    database: context.database.db,
    persistSqlite: context.database.sqlite,
    readProfile: (profileId) => readStrategyProfile(context.database.db, profileId),
    ...context.smartScanTestDeps,
  };
}

export function applySettingsUpdate(req: Request, context: AppContext, update: SettingsUpdate) {
  const session = requireMutationSession(req, context);
  if (update.portfolioView === 'brokerage' && !session) {
    throw new HttpError(401, 'Sign in required.');
  }
  if (update.finderOnDemandSearchEnabled === true && !session) {
    throw new HttpError(401, 'Sign in required to enable on-demand LEAPS searches.');
  }
  if (update.finderOnDemandSearchEnabled === true && !context.config.finderLiveScan) {
    throw new HttpError(
      409,
      'FINDER_LIVE_SCAN is false for this installation. Set FINDER_LIVE_SCAN=true and restart before enabling on-demand searches in Settings.',
    );
  }
  if (update.smartScanMode !== undefined && !session) {
    throw new HttpError(401, 'Sign in required to change Smart Scan mode.');
  }
  // Mode preference may be stored when SMART_SCAN_LIVE is false; live stays simulated until the install gate is on.
  return updateSettings(
    context.database.db,
    update,
    context.config.finderLiveScan,
    context.config.smartScanLive,
  );
}

export function readSettingsView(context: AppContext) {
  return settingsView(context);
}

export function ownerConfiguredForHealth(context: AppContext): boolean {
  return ownerIsConfigured(context.database.db);
}
