import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { ConsoleSms } from './lib/sms.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const server = createApp(db, cfg, new ConsoleSms());
server.listen(cfg.port, () => {
  console.log(`CUPPEE API on http://localhost:${cfg.port} (${cfg.devMode ? 'development' : 'production'})`);
  if (cfg.devMode) console.log('Dev mode: OTP codes are printed here and returned as devCode.');
});
