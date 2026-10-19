import { eq } from 'drizzle-orm';
import {
  finderBookmarkSchema,
  type FinderBookmark,
  type FinderBookmarkWarning,
  type FinderBookmarksResponse,
  type FinderCandidate,
} from '@optionscout/shared';
import { ZodError } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { finderBookmarks } from '../db/schema.js';

/**
 * Fields a pre-verification snapshot may omit. Filling these does not invent prices,
 * Greeks, or provenance. Null / "unavailable" means the historical record did not say.
 */
const LEGACY_SNAPSHOT_DEFAULTS: Record<string, unknown> = {
  observationFreshness: 'unavailable',
  greekVerification: 'unavailable',
  greekProviderEventAt: null,
  validationIssues: [],
};

const LEGACY_FLAG_DEFAULTS: Record<string, null> = {
  unverifiedGreeks: null,
  fromCache: null,
};

function rowToBookmark(row: {
  id: string;
  underlying: string;
  occSymbol: string;
  streamerSymbol: string | null;
  savedAt: string;
  snapshotJson: string;
  profileId?: string | null;
  profileRevision?: number | null;
  scanId?: string | null;
  quoteAsOf?: string | null;
}): FinderBookmark {
  return finderBookmarkSchema.parse({
    id: row.id,
    underlying: row.underlying,
    occSymbol: row.occSymbol,
    streamerSymbol: row.streamerSymbol,
    savedAt: row.savedAt,
    profileId: row.profileId ?? null,
    profileRevision: row.profileRevision ?? null,
    scanId: row.scanId ?? null,
    quoteAsOf: row.quoteAsOf ?? null,
    snapshot: JSON.parse(row.snapshotJson) as FinderCandidate,
  });
}

type BookmarkRow = {
  id: string;
  underlying: string;
  occSymbol: string;
  streamerSymbol: string | null;
  savedAt: string;
  snapshotJson: string;
  profileId?: string | null;
  profileRevision?: number | null;
  scanId?: string | null;
  quoteAsOf?: string | null;
};

function issuePaths(error: ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => (issue.path.length > 0 ? issue.path.join('.') : '(bookmark)'));
}

function fillLegacyMetadata(snapshot: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(LEGACY_SNAPSHOT_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
      snapshot[key] = value;
      missing.push(key);
    }
  }
  const flags = snapshot.flags;
  if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
    const record = flags as Record<string, unknown>;
    for (const [key, value] of Object.entries(LEGACY_FLAG_DEFAULTS)) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        record[key] = value;
        missing.push(`flags.${key}`);
      }
    }
  }
  return missing;
}

function warningBase(row: BookmarkRow): Pick<FinderBookmarkWarning, 'id' | 'underlying' | 'occSymbol' | 'savedAt'> {
  return {
    id: row.id || null,
    underlying: row.underlying || null,
    occSymbol: row.occSymbol || null,
    savedAt: row.savedAt || null,
  };
}

function readStoredBookmark(row: BookmarkRow): { bookmark: FinderBookmark | null; warning: FinderBookmarkWarning | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.snapshotJson);
  } catch {
    return {
      bookmark: null,
      warning: {
        ...warningBase(row),
        code: 'unreadable',
        missingFields: [],
        message: `Saved candidate ${row.underlying || row.id} could not be read and was left out of this list. The stored record was not changed.`,
      },
    };
  }
  const strict = finderBookmarkSchema.safeParse({
    id: row.id,
    underlying: row.underlying,
    occSymbol: row.occSymbol,
    streamerSymbol: row.streamerSymbol,
    savedAt: row.savedAt,
    profileId: row.profileId ?? null,
    profileRevision: row.profileRevision ?? null,
    scanId: row.scanId ?? null,
    quoteAsOf: row.quoteAsOf ?? null,
    snapshot: parsed,
  });
  if (strict.success) return { bookmark: strict.data, warning: null };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      bookmark: null,
      warning: {
        ...warningBase(row),
        code: 'unreadable',
        missingFields: issuePaths(strict.error),
        message: `Saved candidate ${row.underlying || row.id} is incomplete and was left out of this list. The stored record was not changed.`,
      },
    };
  }
  const clone = structuredClone(parsed) as Record<string, unknown>;
  const missing = fillLegacyMetadata(clone);
  const repaired = finderBookmarkSchema.safeParse({
    id: row.id,
    underlying: row.underlying,
    occSymbol: row.occSymbol,
    streamerSymbol: row.streamerSymbol,
    savedAt: row.savedAt,
    profileId: row.profileId ?? null,
    profileRevision: row.profileRevision ?? null,
    scanId: row.scanId ?? null,
    quoteAsOf: row.quoteAsOf ?? null,
    snapshot: clone,
  });
  if (!repaired.success || missing.length === 0) {
    const paths = issuePaths(repaired.success ? strict.error : repaired.error);
    return {
      bookmark: null,
      warning: {
        ...warningBase(row),
        code: 'unreadable',
        missingFields: paths,
        message: `Saved candidate ${row.underlying || row.id} could not be fully reconstructed and was left out of this list. The stored record was not changed. Problem fields: ${paths.join(', ') || 'unknown'}.`,
      },
    };
  }
  return {
    bookmark: repaired.data,
    warning: {
      ...warningBase(row),
      code: 'legacy-reconstructed',
      missingFields: missing,
      message: `Saved candidate ${row.underlying} (${row.occSymbol}) from ${row.savedAt} is missing recorded fields, shown as unavailable: ${missing.join(', ')}. Original prices, Greeks, and provenance were kept. Nothing was estimated.`,
    },
  };
}

export function listFinderBookmarks(db: AppDatabase): FinderBookmarksResponse {
  const read = db
    .select()
    .from(finderBookmarks)
    .all()
    .map((row) => readStoredBookmark(row));
  return {
    bookmarks: read
      .flatMap((row) => (row.bookmark ? [row.bookmark] : []))
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
    warnings: read
      .flatMap((row) => (row.warning ? [row.warning] : []))
      .sort((left, right) => (right.savedAt ?? '').localeCompare(left.savedAt ?? '')),
  };
}

export function saveFinderBookmark(
  db: AppDatabase,
  candidate: FinderCandidate,
  savedAt = new Date().toISOString(),
  meta?: { profileId?: string; profileRevision?: number; scanId?: string },
): FinderBookmark {
  const id = `bm_${candidate.occSymbol.replace(/\s+/g, '')}_${savedAt.replace(/[:.]/g, '')}`;
  const existing = db.select().from(finderBookmarks).where(eq(finderBookmarks.occSymbol, candidate.occSymbol)).all();
  for (const row of existing) {
    db.delete(finderBookmarks).where(eq(finderBookmarks.id, row.id)).run();
  }
  const profileId = meta?.profileId ?? null;
  const profileRevision = meta?.profileRevision ?? null;
  const scanId = meta?.scanId ?? null;
  const quoteAsOf = candidate.providerEventAt ?? candidate.receivedAt ?? null;
  db.insert(finderBookmarks)
    .values({
      id,
      underlying: candidate.underlying,
      occSymbol: candidate.occSymbol,
      streamerSymbol: candidate.streamerSymbol,
      savedAt,
      snapshotJson: JSON.stringify(candidate),
      profileId,
      profileRevision,
      scanId,
      quoteAsOf,
    })
    .run();
  return rowToBookmark({
    id,
    underlying: candidate.underlying,
    occSymbol: candidate.occSymbol,
    streamerSymbol: candidate.streamerSymbol,
    savedAt,
    snapshotJson: JSON.stringify(candidate),
    profileId,
    profileRevision,
    scanId,
    quoteAsOf,
  });
}

export function deleteFinderBookmark(db: AppDatabase, id: string): boolean {
  const existing = db.select().from(finderBookmarks).where(eq(finderBookmarks.id, id)).all();
  if (existing.length === 0) return false;
  db.delete(finderBookmarks).where(eq(finderBookmarks.id, id)).run();
  return true;
}
