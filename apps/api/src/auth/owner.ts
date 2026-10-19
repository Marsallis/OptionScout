import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { ownerCredentials } from '../db/schema.js';
import { PassphraseError, hashPassphrase, verifyPassphrase } from './passphrase.js';

export function ownerIsConfigured(db: AppDatabase): boolean {
  return Boolean(db.select().from(ownerCredentials).where(eq(ownerCredentials.id, 1)).get());
}

export function setupOwnerPassphrase(db: AppDatabase, passphrase: string): void {
  if (ownerIsConfigured(db)) {
    throw new PassphraseError('An owner passphrase is already stored. Run owner-setup with --rotate.');
  }
  const now = new Date().toISOString();
  db.insert(ownerCredentials)
    .values({
      id: 1,
      passwordHash: hashPassphrase(passphrase),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function rotateOwnerPassphrase(db: AppDatabase, current: string, next: string): void {
  const row = db.select().from(ownerCredentials).where(eq(ownerCredentials.id, 1)).get();
  if (!row) {
    throw new PassphraseError('No owner passphrase is stored yet. Run owner-setup without --rotate.');
  }
  if (!verifyPassphrase(current, row.passwordHash)) {
    throw new PassphraseError('The current passphrase did not match.');
  }
  db.update(ownerCredentials)
    .set({ passwordHash: hashPassphrase(next), updatedAt: new Date().toISOString() })
    .where(eq(ownerCredentials.id, 1))
    .run();
}

export function checkOwnerPassphrase(db: AppDatabase, passphrase: string): boolean {
  const row = db.select().from(ownerCredentials).where(eq(ownerCredentials.id, 1)).get();
  if (!row) {
    return false;
  }
  return verifyPassphrase(passphrase, row.passwordHash);
}
