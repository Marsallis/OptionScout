import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenedDatabase {
  sqlite: Database.Database;
  db: AppDatabase;
  close(): void;
}

export function openDatabase(databasePath: string): OpenedDatabase {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    close() {
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      sqlite.close();
    },
  };
}
