import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS members (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,          -- E.164, e.g. +85291234567
  display_name  TEXT,
  preferences   TEXT NOT NULL DEFAULT '{}',    -- JSON: usual drink, milk, sugar, temperature
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS otp_phone ON otp_codes(phone);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('member','staff')),
  subject_id  TEXT NOT NULL,                   -- member id or staff id
  expires_at  INTEGER NOT NULL
);

-- One row per physical cup. uid is the NFC chip UID (hex, upper case).
CREATE TABLE IF NOT EXISTS cups (
  id            TEXT PRIMARY KEY,
  uid           TEXT NOT NULL UNIQUE,
  tag_type      TEXT NOT NULL CHECK (tag_type IN ('ntag424','ntag213')),
  sun_counter   INTEGER NOT NULL DEFAULT -1,   -- last accepted SDMReadCtr (ntag424 only)
  qr_code       TEXT UNIQUE,                   -- laser-etched fallback code
  colourway     TEXT,
  member_id     TEXT REFERENCES members(id),
  nickname      TEXT,
  linked_at     INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cafes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_zh       TEXT,
  district      TEXT,
  address       TEXT,
  lat           REAL,
  lng           REAL,
  location_confirmed INTEGER NOT NULL DEFAULT 0,
  hours         TEXT,
  description   TEXT,
  stamp_goal    INTEGER NOT NULL DEFAULT 9,     -- stamps for the café's own reward
  stamp_reward  TEXT NOT NULL DEFAULT 'Free drink',
  beans_per_visit INTEGER NOT NULL DEFAULT 10,  -- network points per confirmed visit
  beans_per_10hkd INTEGER NOT NULL DEFAULT 1,   -- extra network points per HK$10 when POS order syncs
  pos_provider  TEXT,                           -- adapter name, null = none
  pos_location_ref TEXT,                        -- the POS's id for this shop
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cafe_menu (
  id        TEXT PRIMARY KEY,
  cafe_id   TEXT NOT NULL REFERENCES cafes(id),
  name      TEXT NOT NULL,
  price_hkd REAL,
  pos_item_ref TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id        TEXT PRIMARY KEY,
  cafe_id   TEXT NOT NULL REFERENCES cafes(id),
  name      TEXT NOT NULL,
  pin_hash  TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'barista' CHECK (role IN ('barista','manager'))
);

CREATE TABLE IF NOT EXISTS stands (
  id          TEXT PRIMARY KEY,
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  label       TEXT,
  key_hash    TEXT NOT NULL,
  last_seen_at INTEGER
);

-- Raw reads from the counter stand. One read becomes at most one visit.
CREATE TABLE IF NOT EXISTS stand_events (
  id          TEXT PRIMARY KEY,
  client_event_id TEXT NOT NULL,                -- id the stand generated (idempotency for offline replay)
  stand_id    TEXT NOT NULL REFERENCES stands(id),
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  cup_id      TEXT REFERENCES cups(id),
  uid         TEXT,
  read_at     INTEGER NOT NULL,                 -- when the stand saw the cup
  received_at INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','confirmed','dismissed','duplicate','rejected','unknown_cup','unlinked_cup')),
  reject_reason TEXT,
  visit_id    TEXT,
  UNIQUE (stand_id, client_event_id)
);
CREATE INDEX IF NOT EXISTS se_cafe_status ON stand_events(cafe_id, status, read_at);

CREATE TABLE IF NOT EXISTS visits (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  cup_id      TEXT REFERENCES cups(id),
  source      TEXT NOT NULL CHECK (source IN ('stand','card_qr','pos')),
  staff_id    TEXT REFERENCES staff(id),
  pos_order_id TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_member ON visits(member_id, created_at);
CREATE INDEX IF NOT EXISTS visits_cafe ON visits(cafe_id, created_at);

-- Append-only ledger. cafe_id NULL + unit 'bean' = network points; unit 'stamp' is always per café.
CREATE TABLE IF NOT EXISTS ledger (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  cafe_id     TEXT REFERENCES cafes(id),
  unit        TEXT NOT NULL CHECK (unit IN ('stamp','bean')),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,                    -- visit | spend | redeem | adjust
  ref_id      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_member ON ledger(member_id, unit, cafe_id);

-- Network rewards paid in beans (stamp rewards come from cafes.stamp_goal).
CREATE TABLE IF NOT EXISTS rewards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  cost_beans  INTEGER NOT NULL,
  cafe_id     TEXT REFERENCES cafes(id),        -- null = redeemable at any partner café
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS redemptions (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  kind        TEXT NOT NULL CHECK (kind IN ('stamp_card','reward')),
  reward_id   TEXT REFERENCES rewards(id),
  staff_id    TEXT REFERENCES staff(id),
  created_at  INTEGER NOT NULL
);

-- Orders received from a POS through an adapter, normalised.
CREATE TABLE IF NOT EXISTS pos_orders (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  cafe_id       TEXT NOT NULL REFERENCES cafes(id),
  member_id     TEXT REFERENCES members(id),
  visit_id      TEXT REFERENCES visits(id),
  total_hkd     REAL NOT NULL,
  items         TEXT NOT NULL,                  -- JSON array of {name, qty, price_hkd, pos_item_ref}
  ordered_at    INTEGER NOT NULL,
  match_method  TEXT,                           -- member_ref | visit_window | none
  raw           TEXT,
  UNIQUE (provider, external_id)
);
`;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction (node:sqlite has no helper yet). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
