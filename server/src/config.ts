// All configuration comes from environment variables (see ../.env.example).

function hexKey(name: string, fallback: string): Buffer {
  const v = process.env[name] ?? fallback;
  if (!/^[0-9a-fA-F]{32}$/.test(v)) throw new Error(`${name} must be 32 hex chars (AES-128 key)`);
  return Buffer.from(v, 'hex');
}

export type Config = {
  port: number;
  dbPath: string;
  devMode: boolean;
  /** Secret used to sign rotating member-card QR codes. */
  cardSecret: string;
  /** NTAG 424 SDM keys. All-zero = factory default, only acceptable in development. */
  sdmMetaReadKey: Buffer;
  sdmFileReadKey: Buffer;
  /** Accept plain-UID reads (Phase 0 NTAG 213 cups). Turn off once all cups are NTAG 424. */
  allowUidOnly: boolean;
  debounceMs: number;
  visitCooldownMs: number;
  pendingTtlMs: number;
  posMatchWindowMs: number;
  posSecrets: Record<string, string>;
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const devMode = (process.env.NODE_ENV ?? 'development') !== 'production';
  const cfg: Config = {
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? './cuppee.db',
    devMode,
    cardSecret: process.env.CARD_SECRET ?? (devMode ? 'dev-card-secret' : ''),
    sdmMetaReadKey: hexKey('SDM_META_READ_KEY', '00000000000000000000000000000000'),
    sdmFileReadKey: hexKey('SDM_FILE_READ_KEY', '00000000000000000000000000000000'),
    allowUidOnly: (process.env.ALLOW_UID_ONLY ?? '1') === '1',
    debounceMs: Number(process.env.DEBOUNCE_SECONDS ?? 30) * 1000,
    visitCooldownMs: Number(process.env.VISIT_COOLDOWN_MINUTES ?? 15) * 60_000,
    pendingTtlMs: Number(process.env.PENDING_TTL_MINUTES ?? 15) * 60_000,
    posMatchWindowMs: Number(process.env.POS_MATCH_WINDOW_MINUTES ?? 10) * 60_000,
    posSecrets: {
      generic: process.env.POS_GENERIC_SECRET ?? (devMode ? 'dev-pos-secret' : ''),
    },
    ...overrides,
  };
  if (!cfg.devMode) {
    if (!cfg.cardSecret) throw new Error('CARD_SECRET is required in production');
    if (cfg.sdmMetaReadKey.equals(Buffer.alloc(16))) throw new Error('Set real SDM keys in production');
  }
  return cfg;
}
