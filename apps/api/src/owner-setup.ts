import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { parseConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { applyMigrations, migrationsDirectory } from './db/migrate.js';
import { PassphraseError } from './auth/passphrase.js';
import { readPassphrase } from './auth/prompt.js';
import { rotateOwnerPassphrase, setupOwnerPassphrase } from './auth/owner.js';

function loadLocalEnv(): void {
  if (process.env.RUNNING_IN_DOCKER === 'true') {
    return;
  }
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (file) {
    dotenv.config({ path: file });
  }
}

function refuseArgvPassphrase(argv: string[]): void {
  if (argv.some((arg) => arg.startsWith('--passphrase') || arg.includes('passphrase='))) {
    throw new PassphraseError('Do not pass the passphrase on the command line.');
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  refuseArgvPassphrase(process.argv.slice(2));
  const rotate = process.argv.includes('--rotate');
  const config = parseConfig(process.env);
  const database = openDatabase(config.databasePath);
  try {
    applyMigrations(database.sqlite, migrationsDirectory());
    if (rotate) {
      const current = await readPassphrase('Current passphrase: ');
      const next = await readPassphrase('New passphrase: ');
      const repeat = await readPassphrase('Repeat new passphrase: ');
      if (next !== repeat) {
        throw new PassphraseError('The new passphrase entries did not match.');
      }
      rotateOwnerPassphrase(database.db, current, next);
    } else {
      const passphrase = await readPassphrase('Owner passphrase: ');
      const repeat = await readPassphrase('Repeat passphrase: ');
      if (passphrase !== repeat) {
        throw new PassphraseError('The passphrase entries did not match.');
      }
      setupOwnerPassphrase(database.db, passphrase);
    }
    process.stdout.write('Owner passphrase hash stored.\n');
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof PassphraseError ? error.message : 'Owner setup failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
