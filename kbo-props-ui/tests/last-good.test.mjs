import test from 'node:test';
import assert from 'node:assert/strict';
import { readLastGood, PUBLIC_DATA_CACHE } from '../api/data.js';

const NOW = new Date().toISOString();
const blob = (obj) => ({ text: async () => JSON.stringify(obj) });

test('readLastGood returns the stored row from the private bucket', async () => {
  let bucket = null;
  const client = { storage: { from: (b) => { bucket = b; return { download: async () => ({ data: blob({ data: [1], updated_at: NOW }), error: null }) }; } } };
  assert.deepEqual(await readLastGood(client, 'nhl_projections'), { data: [1], updated_at: NOW });
  assert.equal(bucket, 'board-last-good');
});

test('readLastGood returns null on error or missing data', async () => {
  const err = { storage: { from: () => ({ download: async () => ({ data: null, error: new Error('x') }) }) } };
  assert.equal(await readLastGood(err, 't'), null);
  assert.equal(await readLastGood({}, 't'), null);
});

test('public copies are never served more than 30 min stale on error', () => {
  assert.match(PUBLIC_DATA_CACHE, /stale-if-error=1800/);
});

test('readLastGood refuses copies past the max age', async () => {
  const mk = (iso) => ({ storage: { from: () => ({ download: async () => ({ data: blob({ data: [1], updated_at: iso }), error: null }) }) } });
  const h = (n) => new Date(Date.now() - n * 3600_000).toISOString();
  assert.equal(await readLastGood(mk(h(7)), 'nhl_projections'), null);
  assert.ok(await readLastGood(mk(h(5)), 'nhl_projections'));
  assert.ok(await readLastGood(mk(h(72)), 'nfl_projections'));
  assert.equal(await readLastGood(mk(h(24 * 8)), 'nfl_projections'), null);
  assert.equal(await readLastGood(mk('bad'), 'nfl_projections'), null);
});
