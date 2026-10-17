import test from 'node:test';
import assert from 'node:assert/strict';
import { readLastGood, PUBLIC_DATA_CACHE, LAST_GOOD_KBO_WNBA_MAX_AGE_MS } from '../api/data.js';

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

import { lastGoodTimestamp } from '../api/data.js';
import { readFileSync, existsSync } from 'node:fs';

test('age prefers data[0].generated_at, then top-level generated_at, then updated_at', () => {
  const a = '2026-10-17T00:28:31Z', b = '2026-10-16T00:00:00Z';
  assert.equal(lastGoodTimestamp({ data: [{ generated_at: a }], updated_at: b }), Date.parse(a));
  assert.equal(lastGoodTimestamp({ data: { generated_at: a }, updated_at: b }), Date.parse(a));
  assert.equal(lastGoodTimestamp({ data: [{}], updated_at: b }), Date.parse(b));
  assert.ok(Number.isNaN(lastGoodTimestamp({ data: [{}] })));
});

test('stale updated_at does not hide a fresh generated_at', async () => {
  const fresh = new Date(Date.now() - 3600_000).toISOString();
  const old = new Date(Date.now() - 30 * 86400_000).toISOString();
  const client = { storage: { from: () => ({ download: async () => ({ data: blob({ data: [{ generated_at: fresh }], updated_at: old }), error: null }) }) } };
  assert.ok(await readLastGood(client, 'nhl_projections'));
});

test('nfl_sharp_odds and nfl_game_markets use 6 h; other NFL boards 7 d', async () => {
  const h = (n) => new Date(Date.now() - n * 3600_000).toISOString();
  const mk = (iso) => ({ storage: { from: () => ({ download: async () => ({ data: blob({ data: [{ generated_at: iso }] }), error: null }) }) } });
  for (const t of ['nfl_sharp_odds', 'nfl_game_markets']) {
    assert.equal(await readLastGood(mk(h(7)), t), null);
    assert.ok(await readLastGood(mk(h(5)), t));
  }
  for (const t of ['nfl_projections', 'nfl_lineups', 'correlations_nfl']) {
    assert.ok(await readLastGood(mk(h(72)), t));
  }
});

test('KBO and WNBA keep a last-good copy for 12 h', async () => {
  const h = (n) => new Date(Date.now() - n * 3600_000).toISOString();
  const mk = (iso) => ({ storage: { from: () => ({ download: async () => ({ data: blob({ data: [{ generated_at: iso }] }), error: null }) }) } });
  assert.equal(LAST_GOOD_KBO_WNBA_MAX_AGE_MS, 12 * 3600_000);
  for (const t of ['prizepicks_props', 'wnba_projections_standard', 'wnba_players', 'wnba_lineups']) {
    assert.ok(await readLastGood(mk(h(11)), t), t);
    assert.equal(await readLastGood(mk(h(13)), t), null, t);
  }
  assert.equal(await readLastGood(mk(h(7)), 'nhl_projections'), null);
});
