import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { ConsoleSms } from './lib/sms.ts';
import { migrate } from './migrate.ts';

const cfg = loadConfig();
const db = openDb(cfg.databaseUrl);
// Bring the schema up to date before serving (the runner is locked, so several instances can start together).
const client = await db.pool.connect();
try {
  const applied = await migrate(client);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
} finally {
  client.release();
}
const server = createApp(db, cfg, new ConsoleSms());
server.listen(cfg.port, () => {
  console.log(`CUPPEE API on http://localhost:${cfg.port} (${cfg.devMode ? 'development' : 'production'})`);
  if (cfg.devMode) console.log('Dev mode: OTP codes are printed here and returned as devCode.');
});
