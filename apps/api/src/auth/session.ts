import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type { AppDatabase } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { HttpError } from '../http.js';

const COOKIE = 'os_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface OwnerSession {
  id: string;
  csrfHash: string;
  expiresAt: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function readSessionCookie(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function createOwnerSession(db: AppDatabase, now = new Date()): { token: string; csrfToken: string; expiresAt: string; sessionId: string } {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const sessionId = randomBytes(16).toString('hex');
  db.insert(sessions)
    .values({
      id: sessionId,
      tokenHash: sha256(token),
      csrfHash: sha256(csrfToken),
      expiresAt,
      createdAt: now.toISOString(),
    })
    .run();
  return { token, csrfToken, expiresAt, sessionId };
}

export function findOwnerSession(db: AppDatabase, token: string | null, now = new Date()): OwnerSession | null {
  if (!token) {
    return null;
  }
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token))).get();
  if (!row) {
    return null;
  }
  if (row.expiresAt <= now.toISOString()) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return null;
  }
  return { id: row.id, csrfHash: row.csrfHash, expiresAt: row.expiresAt };
}

export function rotateCsrf(db: AppDatabase, sessionId: string): string {
  const csrfToken = randomBytes(32).toString('base64url');
  db.update(sessions).set({ csrfHash: sha256(csrfToken) }).where(eq(sessions.id, sessionId)).run();
  return csrfToken;
}

export function destroySession(db: AppDatabase, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function assertCsrf(req: Request, session: OwnerSession): void {
  const header = req.get('x-csrf-token');
  if (!header || !hashesEqual(sha256(header), session.csrfHash)) {
    throw new HttpError(403, 'The security token is missing or expired. Refresh the page and try again.');
  }
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', sessionCookie('', 0));
}

export function writeSessionCookie(res: Response, token: string): void {
  res.append('Set-Cookie', sessionCookie(token, SESSION_TTL_MS / 1000));
}
