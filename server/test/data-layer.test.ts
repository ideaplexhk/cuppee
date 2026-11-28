// Backlog M1.1/M1.3: all SQL lives in src/data/ (one module per area), so the database engine can change behind it.
// This test fails if a service, route or script talks to the database directly, or if SQLite comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const SQL_CALL = /\bdb\.(query|one|all|run)\(|\.prepare\(|\bdb\.exec\(/;

test('only src/data/ (plus db.ts and the migration runner) run SQL or import the driver', () => {
  const offenders: string[] = [];
  for (const f of [...files(join(root, 'src')), ...files(join(root, 'seed'))]) {
    const rel = relative(root, f);
    if (rel.startsWith('src/data/') || rel === 'src/db.ts' || rel === 'src/migrate.ts') continue;
    const src = readFileSync(f, 'utf8');
    if (SQL_CALL.test(src) || /from 'pg'/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `SQL outside src/data/: ${offenders.join(', ')}`);
});

test('SQLite is gone: nothing imports node:sqlite', () => {
  const offenders = [...files(join(root, 'src')), ...files(join(root, 'seed')), ...files(join(root, 'test'))]
    .filter((f) => !f.endsWith('data-layer.test.ts') && /from ['"]node:sqlite['"]/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f));
  assert.deepEqual(offenders, []);
});

test('data modules use Postgres placeholders, not SQLite ones', () => {
  const offenders: string[] = [];
  for (const f of files(join(root, 'src', 'data'))) {
    // A bare ? outside a string is how SQLite marks parameters; Postgres uses $1, $2…
    for (const m of readFileSync(f, 'utf8').matchAll(/(['`"])((?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?)\1/g)) {
      if (/\?/.test(m[2])) offenders.push(`${relative(root, f)}: ${m[2].slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
