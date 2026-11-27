// PostgreSQL access for the whole server (backlog M1.3). Only src/data/ (and the migration runner) send SQL;
// services call the data modules, which call the helpers below.
//
// Every HTTP request runs in one SERIALIZABLE transaction (see app.ts). The old SQLite server handled each request
// synchronously, so a request could never interleave with another; serializable transactions keep that guarantee
// now that requests run concurrently on a pool (no double redeem, no double sign-up), and a request that loses a
// race is retried from the start.
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const INT8 = 20;
const NUMERIC = 1700;

/** BIGINT (epoch ms, COUNT, SUM) and NUMERIC (money) arrive as strings by default; the services use numbers. */
const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === INT8)
      return (v: string) => {
        const n = Number(v);
        if (!Number.isSafeInteger(n)) throw new Error(`BIGINT ${v} does not fit a JS number`);
        return n;
      };
    if (oid === NUMERIC) return (v: string) => Number(v);
    return pg.types.getTypeParser(oid, format as any);
  },
};

type Tx = { client: pg.PoolClient; afterCommit: (() => void)[]; savepoints: number };

export type TxOptions = {
  /**
   * Errors for which the transaction still commits before the error is passed on. The request transaction uses
   * this for expected API errors, so a write made before one (such as counting a wrong OTP attempt) is kept.
   */
  commitOn?: (e: unknown) => boolean;
};

export class DB {
  readonly pool: pg.Pool;
  private readonly current = new AsyncLocalStorage<Tx>();

  constructor(config: pg.PoolConfig) {
    this.pool = new pg.Pool({ ...config, types });
  }

  /** Runs one statement on the current transaction's connection, or on the pool outside a transaction. */
  async query<R extends Record<string, any> = any>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<R>> {
    const t = this.current.getStore();
    return (t ? t.client : this.pool).query<R>(sql, params);
  }

  async one<R extends Record<string, any> = any>(sql: string, params: unknown[] = []): Promise<R | undefined> {
    return (await this.query<R>(sql, params)).rows[0];
  }

  async all<R extends Record<string, any> = any>(sql: string, params: unknown[] = []): Promise<R[]> {
    return (await this.query<R>(sql, params)).rows;
  }

  /** Runs a statement and returns how many rows it changed. */
  async run(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.query(sql, params)).rowCount ?? 0;
  }

  get inTransaction() {
    return !!this.current.getStore();
  }

  /** Runs fn after the current transaction commits (never if it rolls back), or now when outside one. */
  afterCommit(fn: () => void) {
    const t = this.current.getStore();
    if (t) t.afterCommit.push(fn);
    else fn();
  }

  async close() {
    await this.pool.end();
  }

  /** @internal Use tx(). */
  async _transaction<T>(fn: () => Promise<T>, opts: TxOptions): Promise<T> {
    const outer = this.current.getStore();
    if (outer) return this.savepoint(outer, fn);
    const client = await this.pool.connect();
    const t: Tx = { client, afterCommit: [], savepoints: 0 };
    let broken = false;
    let result: { value: T } | { error: unknown };
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        result = { value: await this.current.run(t, fn) };
      } catch (e) {
        if (!opts.commitOn?.(e)) throw e;
        result = { error: e };
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => (broken = true));
      throw e;
    } finally {
      client.release(broken);
    }
    // Committed.
    for (const f of t.afterCommit) f();
    if ('error' in result) throw result.error;
    return result.value;
  }

  /** A tx() inside another one: undo just its own writes if it fails, like a nested SQLite transaction would. */
  private async savepoint<T>(t: Tx, fn: () => Promise<T>): Promise<T> {
    const name = `sp_${++t.savepoints}`;
    await t.client.query(`SAVEPOINT ${name}`);
    try {
      const r = await fn();
      await t.client.query(`RELEASE SAVEPOINT ${name}`);
      return r;
    } catch (e) {
      // After a serialization failure the whole transaction is lost anyway; the outer tx() retries it.
      if (!isRetryable(e)) await t.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw e;
    }
  }
}

export function openDb(connectionString: string, extra: pg.PoolConfig = {}): DB {
  return new DB({ connectionString, ...extra });
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const MAX_ATTEMPTS = 5;

function isRetryable(e: unknown) {
  return RETRYABLE.has((e as { code?: string })?.code ?? '');
}

/**
 * Run fn inside one SERIALIZABLE transaction, retrying it from the start if Postgres reports a conflict with a
 * concurrent transaction. A tx() inside another one becomes a savepoint: if it throws, only its own writes are undone.
 */
export async function tx<T>(db: DB, fn: () => Promise<T>, opts: TxOptions = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db._transaction(fn, opts);
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(e) || db.inTransaction) throw e;
      await new Promise((r) => setTimeout(r, Math.random() * 10 * attempt));
    }
  }
}
