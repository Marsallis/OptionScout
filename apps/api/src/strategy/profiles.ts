import {
  SAL_PMCC_DEEP_ITM,
  normalizeStrategyProfile,
  strategyProfileSchema,
  type StrategyProfile,
} from '@optionscout/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { finderOwnerPreferences, strategyProfileRevisions, strategyProfiles } from '../db/schema.js';
import { readMeta, writeMeta } from '../db/meta.js';

const LEGACY_META_KEY = 'strategy_profile:sal-pmcc-deep-itm';

export class StrategyProfileError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'StrategyProfileError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function revisionRowId(profileId: string, revision: number): string {
  return `${profileId}@${revision}`;
}

function insertRevision(db: AppDatabase, profile: StrategyProfile, createdAt: string): void {
  db.insert(strategyProfileRevisions)
    .values({
      id: revisionRowId(profile.id, profile.revision),
      profileId: profile.id,
      revision: profile.revision,
      snapshotJson: JSON.stringify(profile),
      createdAt,
    })
    .run();
}

function upsertProfileRow(
  db: AppDatabase,
  profile: StrategyProfile,
  timestamps: { createdAt: string; updatedAt: string; deletedAt?: string | null },
): void {
  const existing = db.select().from(strategyProfiles).where(eq(strategyProfiles.id, profile.id)).all();
  const values = {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    isDefault: profile.isDefault,
    currentRevision: profile.revision,
    originTemplateId: profile.originTemplateId,
    deletedAt: timestamps.deletedAt ?? null,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
  if (existing.length === 0) {
    db.insert(strategyProfiles).values(values).run();
  } else {
    db.update(strategyProfiles)
      .set({
        name: values.name,
        kind: values.kind,
        isDefault: values.isDefault,
        currentRevision: values.currentRevision,
        originTemplateId: values.originTemplateId,
        deletedAt: values.deletedAt,
        updatedAt: values.updatedAt,
      })
      .where(eq(strategyProfiles.id, profile.id))
      .run();
  }
}

function clearDefaultFlags(db: AppDatabase, exceptId: string): void {
  const rows = db.select().from(strategyProfiles).all();
  for (const row of rows) {
    if (row.id === exceptId || !row.isDefault) continue;
    db.update(strategyProfiles).set({ isDefault: false, updatedAt: nowIso() }).where(eq(strategyProfiles.id, row.id)).run();
  }
}

function ensureOwnerPreferences(db: AppDatabase): void {
  const rows = db.select().from(finderOwnerPreferences).all();
  if (rows.length === 0) {
    db.insert(finderOwnerPreferences)
      .values({
        id: 1,
        defaultProfileId: SAL_PMCC_DEEP_ITM.id,
        lastTicker: 'DEMO',
        lastScanPriority: 'closest-to-strategy',
        updatedAt: nowIso(),
      })
      .run();
  }
}

/** Seed built-in template and migrate legacy meta JSON once. */
export function ensureStrategyProfilesSeeded(db: AppDatabase): void {
  ensureOwnerPreferences(db);
  const existing = db.select().from(strategyProfiles).where(eq(strategyProfiles.id, SAL_PMCC_DEEP_ITM.id)).all();
  if (existing.length === 0) {
    const legacy = readMeta(db, LEGACY_META_KEY);
    const seeded = legacy
      ? normalizeStrategyProfile({
          ...JSON.parse(legacy),
          id: SAL_PMCC_DEEP_ITM.id,
          kind: 'builtin-template',
          isDefault: true,
          revision: 1,
          originTemplateId: null,
        })
      : structuredClone(SAL_PMCC_DEEP_ITM);
    const createdAt = nowIso();
    upsertProfileRow(db, seeded, { createdAt, updatedAt: createdAt });
    insertRevision(db, seeded, createdAt);
    writeMeta(db, LEGACY_META_KEY, JSON.stringify(seeded));
  }
  ensureOwnerPreferences(db);
}

function loadSnapshot(db: AppDatabase, profileId: string, revision: number): StrategyProfile {
  const rows = db
    .select()
    .from(strategyProfileRevisions)
    .where(eq(strategyProfileRevisions.id, revisionRowId(profileId, revision)))
    .all();
  if (rows.length === 0) {
    throw new StrategyProfileError('That strategy revision was not found.', 404);
  }
  return normalizeStrategyProfile(JSON.parse(rows[0]!.snapshotJson) as unknown);
}

export function listStrategyProfiles(db: AppDatabase): StrategyProfile[] {
  ensureStrategyProfilesSeeded(db);
  const rows = db
    .select()
    .from(strategyProfiles)
    .all()
    .filter((row) => row.deletedAt == null)
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name));
  return rows.map((row) => loadSnapshot(db, row.id, row.currentRevision));
}

export function readStrategyProfile(db: AppDatabase, profileId = SAL_PMCC_DEEP_ITM.id): StrategyProfile {
  ensureStrategyProfilesSeeded(db);
  const rows = db.select().from(strategyProfiles).where(eq(strategyProfiles.id, profileId)).all();
  if (rows.length === 0 || rows[0]!.deletedAt != null) {
    if (profileId === SAL_PMCC_DEEP_ITM.id) {
      ensureStrategyProfilesSeeded(db);
      const seeded = db.select().from(strategyProfiles).where(eq(strategyProfiles.id, SAL_PMCC_DEEP_ITM.id)).all()[0]!;
      return { ...loadSnapshot(db, SAL_PMCC_DEEP_ITM.id, seeded.currentRevision), isDefault: seeded.isDefault };
    }
    throw new StrategyProfileError('That strategy profile was not found.', 404);
  }
  const row = rows[0]!;
  return { ...loadSnapshot(db, row.id, row.currentRevision), isDefault: row.isDefault };
}

export function readDefaultStrategyProfile(db: AppDatabase): StrategyProfile {
  ensureStrategyProfilesSeeded(db);
  const preferred = db.select().from(strategyProfiles).all().find((row) => row.isDefault && row.deletedAt == null);
  if (preferred) return loadSnapshot(db, preferred.id, preferred.currentRevision);
  return readStrategyProfile(db, SAL_PMCC_DEEP_ITM.id);
}

export function readStrategyRevision(db: AppDatabase, profileId: string, revision: number): StrategyProfile {
  ensureStrategyProfilesSeeded(db);
  return loadSnapshot(db, profileId, revision);
}

export function createStrategyProfile(
  db: AppDatabase,
  input: unknown,
  options?: { duplicateFromId?: string },
): StrategyProfile {
  ensureStrategyProfilesSeeded(db);
  const base =
    options?.duplicateFromId != null
      ? readStrategyProfile(db, options.duplicateFromId)
      : structuredClone(SAL_PMCC_DEEP_ITM);
  const draft = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id =
    typeof draft.id === 'string' && draft.id.trim() !== ''
      ? draft.id.trim()
      : `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  if (id === SAL_PMCC_DEEP_ITM.id) {
    throw new StrategyProfileError('Create a custom copy instead of overwriting the built-in template id.');
  }
  const existing = db.select().from(strategyProfiles).where(eq(strategyProfiles.id, id)).all();
  if (existing.length > 0 && existing[0]!.deletedAt == null) {
    throw new StrategyProfileError('A strategy with that id already exists.');
  }
  const createdAt = nowIso();
  const profile = normalizeStrategyProfile({
    ...base,
    ...draft,
    id,
    kind: 'custom',
    originTemplateId: base.originTemplateId ?? SAL_PMCC_DEEP_ITM.id,
    revision: 1,
    isDefault: false,
    name: typeof draft.name === 'string' && draft.name.trim() !== '' ? draft.name.trim() : `${base.name} (copy)`,
  });
  upsertProfileRow(db, profile, { createdAt, updatedAt: createdAt, deletedAt: null });
  insertRevision(db, profile, createdAt);
  return profile;
}

export function saveStrategyProfile(db: AppDatabase, profileId: string, input: unknown): StrategyProfile {
  ensureStrategyProfilesSeeded(db);
  const current = readStrategyProfile(db, profileId);
  const draft = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (typeof draft.id === 'string' && draft.id !== profileId) {
    throw new StrategyProfileError('Profile id cannot change on save. Use Save As / duplicate instead.');
  }
  const nextRevision = current.revision + 1;
  const updatedAt = nowIso();
  const profile = normalizeStrategyProfile({
    ...current,
    ...draft,
    id: profileId,
    kind: current.kind === 'builtin-template' ? 'builtin-template' : 'custom',
    originTemplateId: current.originTemplateId,
    revision: nextRevision,
    isDefault: current.isDefault,
    name: typeof draft.name === 'string' && draft.name.trim() !== '' ? draft.name.trim() : current.name,
  });
  // Built-in template remains recoverable: edits create a new revision on the same id,
  // and resetBuiltinTemplate restores revision content from SAL_PMCC_DEEP_ITM defaults.
  upsertProfileRow(db, profile, {
    createdAt: db.select().from(strategyProfiles).where(eq(strategyProfiles.id, profileId)).all()[0]?.createdAt ?? updatedAt,
    updatedAt,
  });
  insertRevision(db, profile, updatedAt);
  if (profileId === SAL_PMCC_DEEP_ITM.id) {
    writeMeta(db, LEGACY_META_KEY, JSON.stringify(profile));
  }
  return profile;
}

export function saveStrategyProfileAs(db: AppDatabase, sourceId: string, name: string): StrategyProfile {
  const source = readStrategyProfile(db, sourceId);
  return createStrategyProfile(db, {
    ...source,
    name,
    id: undefined,
  });
}

export function duplicateStrategyProfile(db: AppDatabase, sourceId: string, name?: string): StrategyProfile {
  const source = readStrategyProfile(db, sourceId);
  return createStrategyProfile(
    db,
    {
      ...source,
      name: name?.trim() || `${source.name} (copy)`,
      id: undefined,
    },
    { duplicateFromId: sourceId },
  );
}

export function setDefaultStrategyProfile(db: AppDatabase, profileId: string): StrategyProfile {
  const profile = readStrategyProfile(db, profileId);
  clearDefaultFlags(db, profileId);
  const updatedAt = nowIso();
  db.update(strategyProfiles)
    .set({ isDefault: true, updatedAt })
    .where(eq(strategyProfiles.id, profileId))
    .run();
  ensureOwnerPreferences(db);
  db.update(finderOwnerPreferences)
    .set({ defaultProfileId: profileId, updatedAt })
    .where(eq(finderOwnerPreferences.id, 1))
    .run();
  return { ...profile, isDefault: true };
}

export function resetBuiltinTemplate(db: AppDatabase): StrategyProfile {
  ensureStrategyProfilesSeeded(db);
  const current = readStrategyProfile(db, SAL_PMCC_DEEP_ITM.id);
  const updatedAt = nowIso();
  const restored = normalizeStrategyProfile({
    ...SAL_PMCC_DEEP_ITM,
    revision: current.revision + 1,
    isDefault: current.isDefault,
  });
  upsertProfileRow(db, restored, {
    createdAt: db.select().from(strategyProfiles).where(eq(strategyProfiles.id, SAL_PMCC_DEEP_ITM.id)).all()[0]!.createdAt,
    updatedAt,
  });
  insertRevision(db, restored, updatedAt);
  writeMeta(db, LEGACY_META_KEY, JSON.stringify(restored));
  return restored;
}

export function deleteStrategyProfile(db: AppDatabase, profileId: string, confirmed: boolean): void {
  if (!confirmed) {
    throw new StrategyProfileError('Deleting a custom strategy requires confirmation.');
  }
  if (profileId === SAL_PMCC_DEEP_ITM.id) {
    throw new StrategyProfileError('The built-in Sal PMCC template cannot be deleted. Reset it instead.');
  }
  const rows = db.select().from(strategyProfiles).where(eq(strategyProfiles.id, profileId)).all();
  if (rows.length === 0 || rows[0]!.deletedAt != null) {
    throw new StrategyProfileError('That strategy profile was not found.', 404);
  }
  const wasDefault = rows[0]!.isDefault;
  const updatedAt = nowIso();
  db.update(strategyProfiles)
    .set({ deletedAt: updatedAt, isDefault: false, updatedAt })
    .where(eq(strategyProfiles.id, profileId))
    .run();
  // Prior revisions remain on disk for bookmarks/scans that reference them.
  if (wasDefault) {
    setDefaultStrategyProfile(db, SAL_PMCC_DEEP_ITM.id);
  }
}

export function parseStrategyProfileInput(input: unknown): StrategyProfile {
  return strategyProfileSchema.parse(normalizeStrategyProfile(input));
}

/** Legacy helper used by older routes — saves the built-in id only. */
export function saveLegacySalProfile(db: AppDatabase, input: unknown): StrategyProfile {
  return saveStrategyProfile(db, SAL_PMCC_DEEP_ITM.id, input);
}
