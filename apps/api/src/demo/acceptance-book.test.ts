import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPortfolio } from '../accounting/portfolio.js';
import { openDatabase, type OpenedDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { listSavedIdeas } from '../finder/saved-ideas.js';
import { seedAcceptanceBook } from './seed-acceptance-book.js';

const databases: OpenedDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const opened of databases.splice(0)) opened.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('fictional acceptance book', () => {
  it('keeps closed contracts out of the open set and groups the confirmed PMCC once', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-acceptance-'));
    directories.push(directory);
    const opened = openDatabase(path.join(directory, 'optionscout.sqlite'));
    databases.push(opened);
    applyMigrations(opened.sqlite, migrationsDirectory());
    seedAcceptanceBook(opened.db);
    const account = opened.sqlite.prepare(`SELECT id, masked_label FROM broker_accounts`).get() as { id: string; masked_label: string };
    const portfolio = buildPortfolio(opened.db, account.id, new Date('2026-10-21T15:00:00.000Z'));
    const open = portfolio.positions.filter((position) => position.direction !== 'flat');
    const closed = portfolio.positions.filter((position) => position.direction === 'flat' && position.status !== 'unreconciled');
    expect(account.masked_label).toBe('••••0111');
    expect(JSON.stringify(portfolio)).not.toContain('ZZQA000111');
    expect(portfolio.strategies).toHaveLength(1);
    expect(open.map((position) => position.symbol).sort()).toEqual([
      'QQQ   280121C00300000',
      'SPY   261218C00450000',
      'ZZT   261030C00227500',
      'ZZT   280121C00155000',
    ].sort());
    expect(closed.map((position) => position.symbol).sort()).toEqual([
      'ZZT   260116C00180000',
      'ZZT   260402C00210000',
    ].sort());
    expect(portfolio.positions.some((position) => position.status === 'unreconciled' && position.symbol === 'AMD')).toBe(true);
    const grouped = new Set([portfolio.strategies[0]?.longSymbol, portfolio.strategies[0]?.performance.shortSymbols[0]]);
    expect(open.filter((position) => !grouped.has(position.symbol))).toHaveLength(2);
    const unquoted = open.find((position) => position.symbol.startsWith('QQQ'));
    expect(unquoted?.mark ?? unquoted?.mid ?? null).toBeNull();
    const ideas = listSavedIdeas(opened.db);
    expect(ideas.map((idea) => idea.kind).sort()).toEqual(['leaps-idea', 'pmcc-setup']);
    expect(ideas.every((idea) => idea.hypothetical)).toBe(true);
  });
});
