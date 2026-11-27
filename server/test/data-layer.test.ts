// Backlog M1.1: all SQL lives in src/data/ (one module per area), so the database engine can change behind it.
// This test fails if a service, route or script talks to the database directly again.
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

test('only src/data/ and src/db.ts run SQL or import node:sqlite', () => {
  const offenders: string[] = [];
  for (const f of [...files(join(root, 'src')), ...files(join(root, 'seed'))]) {
    const rel = relative(root, f);
    if (rel.startsWith('src/data/') || rel === 'src/db.ts') continue;
    const src = readFileSync(f, 'utf8');
    if (/\.prepare\(|\bdb\.exec\(|node:sqlite/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `SQL outside src/data/: ${offenders.join(', ')}`);
});
