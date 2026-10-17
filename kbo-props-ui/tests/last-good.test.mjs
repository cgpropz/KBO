import test from 'node:test';
import assert from 'node:assert/strict';
import { readLastGood, PUBLIC_DATA_CACHE } from '../api/data.js';

const blob = (obj) => ({ text: async () => JSON.stringify(obj) });

test('readLastGood returns the stored row from the private bucket', async () => {
  let bucket = null;
  const client = { storage: { from: (b) => { bucket = b; return { download: async () => ({ data: blob({ data: [1], updated_at: 't' }), error: null }) }; } } };
  assert.deepEqual(await readLastGood(client, 'nhl_projections'), { data: [1], updated_at: 't' });
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
