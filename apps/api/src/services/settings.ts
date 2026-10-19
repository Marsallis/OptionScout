import { eq } from 'drizzle-orm';
import { settingsSchema, type SettingsUpdate, type SettingsView } from '@optionscout/shared';
import type { AppDatabase } from '../db/client.js';
import { settings } from '../db/schema.js';

export function readSettings(
  db: AppDatabase,
  finderLiveScanInstallAllowed = false,
  smartScanLiveInstallAllowed = false,
): SettingsView {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) {
    throw new Error('Local settings row is missing.');
  }
  const mode = row.smartScanMode === 'diagnostic' ? 'diagnostic' : 'normal';
  const parsed = settingsSchema.safeParse({
    demo: true,
    density: row.density,
    showGreeks: row.showGreeks,
    dataMode: 'demo',
    authMode: 'local-owner',
    portfolioView: row.portfolioView === 'brokerage' ? 'brokerage' : 'demo',
    finderLiveScanInstallAllowed,
    finderOnDemandSearchEnabled: Boolean(row.finderOnDemandSearch),
    smartScanMode: mode,
    smartScanLiveInstallAllowed,
    ordersEnabled: false,
    telemetryEnabled: false,
    updatedAt: row.updatedAt,
  });
  if (!parsed.success) {
    throw new Error('Stored settings are invalid.');
  }
  return parsed.data;
}

export function updateSettings(
  db: AppDatabase,
  update: SettingsUpdate,
  finderLiveScanInstallAllowed = false,
  smartScanLiveInstallAllowed = false,
): SettingsView {
  const current = readSettings(db, finderLiveScanInstallAllowed, smartScanLiveInstallAllowed);
  const updatedAt = new Date().toISOString();
  db.update(settings)
    .set({
      density: update.density ?? current.density,
      showGreeks: update.showGreeks ?? current.showGreeks,
      portfolioView: update.portfolioView ?? current.portfolioView,
      finderOnDemandSearch:
        update.finderOnDemandSearchEnabled === undefined
          ? current.finderOnDemandSearchEnabled
          : update.finderOnDemandSearchEnabled,
      smartScanMode: update.smartScanMode ?? current.smartScanMode,
      updatedAt,
    })
    .where(eq(settings.id, 1))
    .run();
  return readSettings(db, finderLiveScanInstallAllowed, smartScanLiveInstallAllowed);
}
