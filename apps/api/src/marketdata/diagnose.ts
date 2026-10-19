import { brokerageBaseUrl, TastytradeClient } from '../brokerage/client.js';
import { parseConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { runDxlinkDiagnostic } from './diagnostic.js';
import { openLiveDxlinkSocket } from './live-socket.js';

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'DXLink diagnostic failed.';
  if (/bearer|token|secret|refresh/i.test(message)) return 'DXLink diagnostic failed.';
  return message;
}

export async function main(): Promise<void> {
  if (process.argv[2] !== '--confirm-live-dxlink') {
    console.error('Refusing to open DXLink. Pass --confirm-live-dxlink.');
    process.exitCode = 2;
    return;
  }
  const config = parseConfig(process.env);
  if (!config.dxlinkLiveDiagnostic || !config.liveEnabled || !config.tastytrade || config.tastytradeEnvironment === 'unset') {
    console.error('DXLink live diagnostic is disabled.');
    process.exitCode = 2;
    return;
  }
  const database = openDatabase(config.databasePath);
  applyMigrations(database.sqlite, migrationsDirectory());
  let closeCode: number | null = null;
  try {
    const client = new TastytradeClient({
      baseUrl: brokerageBaseUrl(config.tastytradeEnvironment),
      credentials: config.tastytrade,
    });
    const report = await runDxlinkDiagnostic({
      enabled: true,
      db: database.db,
      client,
      connect: (url) => openLiveDxlinkSocket(url, { onCloseCode: (code) => { closeCode = code; } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log(JSON.stringify({ ...report, closeCode }));
  } catch (error) {
    console.error(safeMessage(error));
    process.exitCode = 1;
  } finally {
    database.sqlite.close();
  }
}

const entry = process.argv[1]?.replaceAll('\\', '/');
if (entry?.endsWith('/diagnose.js') || entry?.endsWith('/diagnose.ts')) {
  await main();
}
