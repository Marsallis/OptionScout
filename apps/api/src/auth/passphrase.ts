import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export class PassphraseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PassphraseError';
  }
}

export function assertPassphrasePolicy(passphrase: string): void {
  if (passphrase.length < 12 || passphrase.trim().length < 12) {
    throw new PassphraseError('The owner passphrase must be at least 12 characters.');
  }
  if (passphrase.length > 200) {
    throw new PassphraseError('The owner passphrase is too long.');
  }
}

export function hashPassphrase(passphrase: string): string {
  assertPassphrasePolicy(passphrase);
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallel = Number(parts[3]);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallel)) {
    return false;
  }
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const actual = scryptSync(passphrase, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallel,
    maxmem: 64 * 1024 * 1024,
  });
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
