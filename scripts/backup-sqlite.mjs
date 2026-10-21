// Online SQLite backup. Run in a one-off container. docker exec cannot add a mount.
// Source volume is read-only. BACKUP_DEST must be a new filepath on a separate mount.
// The destination is a string path passed to better-sqlite3 backup(), which uses SQLite's backup API.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/app/package.json');
const Database = require('better-sqlite3');

const sourcePath = process.env.BACKUP_SOURCE ?? '';
const destPath = process.env.BACKUP_DEST ?? '';

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

if (!sourcePath || !destPath) {
  fail(2, 'BACKUP_SOURCE and BACKUP_DEST are required.');
} else if (fs.existsSync(destPath)) {
  fail(3, 'Backup destination already exists. Refusing to overwrite.');
} else if (!fs.existsSync(sourcePath)) {
  fail(4, 'Source database was not found.');
} else if (!fs.existsSync(path.dirname(destPath))) {
  fail(2, 'Backup directory does not exist.');
} else {
  const partialPath = `${destPath}.partial`;
  if (fs.existsSync(partialPath)) fs.rmSync(partialPath, { force: true });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(partialPath);
  } catch (error) {
    if (fs.existsSync(partialPath)) fs.rmSync(partialPath, { force: true });
    fail(5, 'SQLite online backup failed.');
    throw error;
  } finally {
    source.close();
  }
  const backup = new Database(partialPath, { fileMustExist: true });
  let integrity = null;
  try {
    const check = backup.prepare('PRAGMA integrity_check').get();
    integrity = check ? Object.values(check)[0] : null;
    backup.pragma('wal_checkpoint(TRUNCATE)');
    backup.pragma('journal_mode = DELETE');
  } finally {
    backup.close();
  }
  if (integrity !== 'ok') {
    if (fs.existsSync(partialPath)) fs.rmSync(partialPath, { force: true });
    fail(6, 'Backup integrity_check did not return ok.');
  } else {
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${partialPath}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    const bytes = fs.statSync(partialPath).size;
    fs.renameSync(partialPath, destPath);
    process.stdout.write(`${JSON.stringify({ integrity: 'ok', bytes })}\n`);
  }
}
