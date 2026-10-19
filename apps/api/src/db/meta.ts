import { eq } from 'drizzle-orm';
import type { AppDatabase } from './client.js';
import { appMeta } from './schema.js';

export function readMeta(db: AppDatabase, key: string): string | null {
  return db.select().from(appMeta).where(eq(appMeta.key, key)).get()?.value ?? null;
}

export function writeMeta(db: AppDatabase, key: string, value: string): void {
  const now = new Date().toISOString();
  const existing = db.select().from(appMeta).where(eq(appMeta.key, key)).get();
  if (existing) {
    db.update(appMeta).set({ value, updatedAt: now }).where(eq(appMeta.key, key)).run();
    return;
  }
  db.insert(appMeta).values({ key, value, updatedAt: now }).run();
}
