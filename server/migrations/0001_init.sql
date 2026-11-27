-- 0001: PostgreSQL version of the v0.1 schema (server/src/db.ts, SQLite). Same tables and columns.
-- Times stay as epoch milliseconds (BIGINT) so the services do not change meaning in the port (M1.3).
-- Differences from SQLite, on purpose:
--   * money is NUMERIC(10,2), never floating point;
--   * otp_codes gets an id column, because Postgres has no rowid;
--   * 0/1 flags stay INTEGER with a CHECK, so the port can keep its comparisons;
--   * a stamp ledger row must name its café (it already always does in code).
-- Every café-owned row carries cafe_id: cafe_menu, staff, stands, stand_events, visits, redemptions, pos_orders,
-- and stamp rows in ledger. Beans and rewards with cafe_id NULL belong to the whole network.

CREATE TABLE members (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,          -- E.164, e.g. +85291234567
  display_name  TEXT,
  preferences   TEXT NOT NULL DEFAULT '{}',    -- JSON: usual drink, milk, sugar, temperature
  created_at    BIGINT NOT NULL
);

CREATE TABLE otp_codes (
  id          BIGSERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  BIGINT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX otp_phone ON otp_codes(phone);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('member','staff')),
  subject_id  TEXT NOT NULL,                   -- member id or staff id
  expires_at  BIGINT NOT NULL
);

-- One row per physical cup. uid is the NFC chip UID (hex, upper case).
CREATE TABLE cups (
  id            TEXT PRIMARY KEY,
  uid           TEXT NOT NULL UNIQUE,
  tag_type      TEXT NOT NULL CHECK (tag_type IN ('ntag424','ntag213')),
  sun_counter   INTEGER NOT NULL DEFAULT -1,   -- last accepted SDMReadCtr (ntag424 only)
  qr_code       TEXT UNIQUE,                   -- laser-etched fallback code
  colourway     TEXT,
  member_id     TEXT REFERENCES members(id),
  nickname      TEXT,
  linked_at     BIGINT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE cafes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_zh       TEXT,
  district      TEXT,
  address       TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  location_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (location_confirmed IN (0,1)),
  hours         TEXT,
  description   TEXT,
  stamp_goal    INTEGER NOT NULL DEFAULT 9,     -- stamps for the café's own reward
  stamp_reward  TEXT NOT NULL DEFAULT 'Free drink',
  beans_per_visit INTEGER NOT NULL DEFAULT 10,  -- network points per confirmed visit
  beans_per_10hkd INTEGER NOT NULL DEFAULT 1,   -- extra network points per HK$10 when POS order syncs
  pos_provider  TEXT,                           -- adapter name, null = none
  pos_location_ref TEXT,                        -- the POS's id for this shop
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE cafe_menu (
  id        TEXT PRIMARY KEY,
  cafe_id   TEXT NOT NULL REFERENCES cafes(id),
  name      TEXT NOT NULL,
  price_hkd NUMERIC(10,2),
  pos_item_ref TEXT
);

CREATE TABLE staff (
  id        TEXT PRIMARY KEY,
  cafe_id   TEXT NOT NULL REFERENCES cafes(id),
  name      TEXT NOT NULL,
  pin_hash  TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'barista' CHECK (role IN ('barista','manager'))
);

CREATE TABLE stands (
  id          TEXT PRIMARY KEY,
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  label       TEXT,
  key_hash    TEXT NOT NULL,
  last_seen_at BIGINT
);

-- Raw reads from the counter stand. One read becomes at most one visit.
CREATE TABLE stand_events (
  id          TEXT PRIMARY KEY,
  client_event_id TEXT NOT NULL,                -- id the stand generated (idempotency for offline replay)
  stand_id    TEXT NOT NULL REFERENCES stands(id),
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  cup_id      TEXT REFERENCES cups(id),
  uid         TEXT,
  read_at     BIGINT NOT NULL,                  -- when the stand saw the cup
  received_at BIGINT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','confirmed','dismissed','duplicate','rejected','unknown_cup','unlinked_cup')),
  reject_reason TEXT,
  visit_id    TEXT,
  UNIQUE (stand_id, client_event_id)
);
CREATE INDEX se_cafe_status ON stand_events(cafe_id, status, read_at);

CREATE TABLE visits (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  cup_id      TEXT REFERENCES cups(id),
  source      TEXT NOT NULL CHECK (source IN ('stand','card_qr','pos')),
  staff_id    TEXT REFERENCES staff(id),
  pos_order_id TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX visits_member ON visits(member_id, created_at);
CREATE INDEX visits_cafe ON visits(cafe_id, created_at);

-- Append-only ledger. cafe_id NULL + unit 'bean' = network points; unit 'stamp' is always per café.
CREATE TABLE ledger (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  cafe_id     TEXT REFERENCES cafes(id),
  unit        TEXT NOT NULL CHECK (unit IN ('stamp','bean')),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,                    -- visit | spend | redeem | adjust | refund
  ref_id      TEXT,
  created_at  BIGINT NOT NULL,
  CHECK (unit <> 'stamp' OR cafe_id IS NOT NULL)
);
CREATE INDEX ledger_member ON ledger(member_id, unit, cafe_id);

-- Network rewards paid in beans (stamp rewards come from cafes.stamp_goal).
CREATE TABLE rewards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  cost_beans  INTEGER NOT NULL,
  cafe_id     TEXT REFERENCES cafes(id),        -- null = redeemable at any partner café
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE redemptions (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  cafe_id     TEXT NOT NULL REFERENCES cafes(id),
  kind        TEXT NOT NULL CHECK (kind IN ('stamp_card','reward')),
  reward_id   TEXT REFERENCES rewards(id),
  staff_id    TEXT REFERENCES staff(id),
  created_at  BIGINT NOT NULL
);

-- Orders received from a POS through an adapter, normalised.
CREATE TABLE pos_orders (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  cafe_id       TEXT NOT NULL REFERENCES cafes(id),
  member_id     TEXT REFERENCES members(id),
  visit_id      TEXT REFERENCES visits(id),
  total_hkd     NUMERIC(10,2) NOT NULL,
  items         TEXT NOT NULL,                  -- JSON array of {name, qty, price_hkd, pos_item_ref}
  ordered_at    BIGINT NOT NULL,
  match_method  TEXT,                           -- member_ref | visit_window | none
  raw           TEXT,
  UNIQUE (provider, external_id)
);
