import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { createSavedIdea, deleteSavedIdea, listSavedIdeas, SavedIdeaError } from './saved-ideas.js';

const databases: OpenedDatabase[] = [];
const directories: string[] = [];

function db() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-ideas-'));
  directories.push(directory);
  const opened = openDatabase(path.join(directory, 'optionscout.sqlite'));
  databases.push(opened);
  applyMigrations(opened.sqlite, migrationsDirectory());
  return opened.db;
}

afterEach(() => {
  for (const opened of databases.splice(0)) opened.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const longOcc = 'ZZT   280121C00155000';
const shortOcc = 'ZZT   261030C00227500';

describe('saved research ideas', () => {
  it('stores a long call as a LEAPS idea and a later short call as a PMCC setup', () => {
    const database = db();
    const leaps = createSavedIdea(database, {
      underlying: 'ZZT',
      longOcc,
      profileId: 'sal-pmcc-deep-itm',
      profileRevision: 1,
      sessionId: 'session-1',
      quoteAsOf: '2026-10-15T20:00:00.000Z',
    });
    expect(leaps.kind).toBe('leaps-idea');
    expect(leaps.notACurrentQuote).toBe(true);
    const pmcc = createSavedIdea(database, { underlying: 'ZZT', longOcc, shortOcc, quoteAsOf: '2026-10-15T20:00:00.000Z' });
    expect(pmcc.kind).toBe('pmcc-setup');
    expect(pmcc.structureNote).toMatch(/not a delta, intrinsic-value, or profitability check/);
    expect(pmcc.shortOcc).toBe(shortOcc);
    const unconventional = createSavedIdea(database, {
      underlying: 'ZZT',
      longOcc: 'ZZT   280121C00250000',
      shortOcc: 'ZZT   261030C00155000',
    });
    expect(unconventional.kind).toBe('reviewed-pair');
    expect(unconventional.structureNote).toMatch(/not a conventional PMCC/);
    expect(unconventional.structureNote).toMatch(/were not evaluated/);
    deleteSavedIdea(database, pmcc.id);
    expect(listSavedIdeas(database).some((row) => row.id === pmcc.id)).toBe(false);
    expect(listSavedIdeas(database).some((row) => row.id === leaps.id)).toBe(true);
  });

  it('rejects a mismatched underlying, a put, and a short call that expires too late', () => {
    const database = db();
    expect(() => createSavedIdea(database, { underlying: 'QQQ', longOcc })).toThrow(SavedIdeaError);
    expect(() => createSavedIdea(database, { underlying: 'ZZT', longOcc: 'ZZT   280121P00155000' })).toThrow(/must be a call/);
    expect(() => createSavedIdea(database, { underlying: 'ZZT', longOcc: shortOcc, shortOcc: longOcc })).toThrow(/expire before/);
    expect(listSavedIdeas(database)).toEqual([]);
  });
});
