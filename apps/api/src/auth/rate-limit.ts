import { and, eq, gt } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { loginAttempts } from '../db/schema.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function loginIsLocked(db: AppDatabase, now = new Date()): boolean {
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  const failures = db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.succeeded, false), gt(loginAttempts.attemptedAt, cutoff)))
    .all();
  return failures.length >= MAX_FAILURES;
}

export function recordLoginAttempt(db: AppDatabase, succeeded: boolean, now = new Date()): void {
  db.insert(loginAttempts)
    .values({ attemptedAt: now.toISOString(), succeeded })
    .run();
  if (succeeded) {
    db.delete(loginAttempts).where(eq(loginAttempts.succeeded, false)).run();
  }
}
