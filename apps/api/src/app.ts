import fs from 'node:fs';
import path from 'node:path';
import { HOLDINGS_IMPORT_MAX_REQUEST_BYTES, healthSchema, settingsUpdateSchema } from '@optionscout/shared';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type { AppContext } from './context.js';
import { HttpError } from './http.js';
import { logError } from './logger.js';
import {
  applySettingsUpdate,
  ownerConfiguredForHealth,
  readSettingsView,
  registerRoutes,
  requireMutationSession,
} from './routes.js';
import { buildDashboard } from './services/dashboard.js';

export function createApp(context: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // ETF holdings files are the only large JSON bodies. Owner auth and CSRF run before buffering them.
  app.use(
    '/api/discovery/universes/holdings',
    (req, _res, next) => {
      try {
        if (req.method === 'POST' && !requireMutationSession(req, context)) {
          throw new HttpError(401, 'Sign in required.');
        }
        next();
      } catch (error) {
        next(error);
      }
    },
    express.json({ limit: HOLDINGS_IMPORT_MAX_REQUEST_BYTES }),
  );
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    const body = {
      status: 'ok' as const,
      service: 'optionscout' as const,
      phase: '1C' as const,
      dataMode: context.config.dataMode,
      demo: true as const,
      database: 'ok' as const,
      bootCount: context.bootCount,
      ordersEnabled: false as const,
      telemetryEnabled: false as const,
      liveEnabled: context.config.liveEnabled,
      scheduledSyncEnabled: false as const,
      ownerConfigured: ownerConfiguredForHealth(context),
      publicSimulatedDemo: context.config.publicSimulatedDemo,
      hostedPublicDemo: context.config.hostedPublicDemo,
    };
    res.json(healthSchema.parse(body));
  });

  app.get('/api/dashboard', (_req, res, next) => {
    try {
      res.json(buildDashboard(context.database.db));
    } catch (error) {
      next(error);
    }
  });

  registerRoutes(app, context);

  app.get('/api/settings', (_req, res, next) => {
    try {
      res.json(readSettingsView(context));
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/settings', (req, res, next) => {
    try {
      const parsed = settingsUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Settings update rejected.' });
        return;
      }
      res.json(applySettingsUpdate(req, context, parsed.data));
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const staticDir = context.config.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, fallthrough: true }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(path.join(staticDir, 'index.html'), (error) => {
        if (error) {
          next(error);
        }
      });
    });
  }

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      if (!res.headersSent) {
        res.status(error.status).json({ error: error.message });
      }
      return;
    }
    const bodyError = error as { type?: string } | null;
    if (bodyError?.type === 'entity.too.large') {
      if (!res.headersSent) res.status(413).json({ error: 'Request body is too large for this endpoint.' });
      return;
    }
    const detail = process.env.NODE_ENV === 'test' && error instanceof Error ? error.message : undefined;
    logError(detail ?? 'Request failed');
    if (res.headersSent) {
      return;
    }
    const status = error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'Request body was not valid JSON.' : 'Request failed', ...(detail && status === 500 ? { detail } : {}) });
  };
  app.use(handleError);

  return app;
}
