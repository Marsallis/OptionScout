import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAL_PMCC_DEEP_ITM } from '@optionscout/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import {
  createStrategyProfile,
  deleteStrategyProfile,
  duplicateStrategyProfile,
  listStrategyProfiles,
  readStrategyProfile,
  readStrategyRevision,
  resetBuiltinTemplate,
  saveStrategyProfile,
  setDefaultStrategyProfile,
} from './profiles.js';

const contexts: AppContext[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function opened(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-strat-'));
  directories.push(directory);
  const context = await openAppContext(
    parseConfig(
      {
        NODE_ENV: 'test',
        PORT: '3181',
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: path.join(directory, 'optionscout.sqlite'),
        DATA_MODE: 'demo',
        AUTH_MODE: 'local-owner',
        ENABLE_ORDER_EXECUTION: 'false',
        TELEMETRY_ENABLED: 'false',
        RUNNING_IN_DOCKER: 'false',
        STATIC_DIR: '',
        FINDER_LIVE_SCAN: 'false',
      },
      { secretFilePath: path.join(directory, 'missing.env') },
    ),
  );
  contexts.push(context);
  return context;
}

describe('strategy profile persistence', () => {
  it('seeds the built-in template, creates revisions, duplicates, and preserves history', async () => {
    const context = await opened();
    const db = context.database.db;
    const listed = listStrategyProfiles(db);
    expect(listed.some((row) => row.id === SAL_PMCC_DEEP_ITM.id)).toBe(true);

    const first = readStrategyProfile(db, SAL_PMCC_DEEP_ITM.id);
    expect(first.revision).toBe(1);
    const edited = saveStrategyProfile(db, SAL_PMCC_DEEP_ITM.id, {
      ...first,
      hard: { ...first.hard, maxContractCost: '6500.00' },
    });
    expect(edited.revision).toBe(2);
    expect(edited.hard.maxContractCost).toBe('6500.00');
    const historical = readStrategyRevision(db, SAL_PMCC_DEEP_ITM.id, 1);
    expect(historical.hard.maxContractCost).toBe('7000.00');

    const copy = duplicateStrategyProfile(db, SAL_PMCC_DEEP_ITM.id, 'My copy');
    expect(copy.kind).toBe('custom');
    expect(copy.originTemplateId).toBe(SAL_PMCC_DEEP_ITM.id);
    expect(copy.id).not.toBe(SAL_PMCC_DEEP_ITM.id);

    setDefaultStrategyProfile(db, copy.id);
    expect(readStrategyProfile(db, copy.id).isDefault).toBe(true);

    const created = createStrategyProfile(db, { name: 'Scratch', hard: { ...SAL_PMCC_DEEP_ITM.hard } });
    expect(created.revision).toBe(1);
    deleteStrategyProfile(db, created.id, true);
    expect(() => readStrategyProfile(db, created.id)).toThrow(/not found/i);

    const restored = resetBuiltinTemplate(db);
    expect(restored.hard.maxContractCost).toBe('7000.00');
    expect(restored.revision).toBeGreaterThan(2);
  });
});
