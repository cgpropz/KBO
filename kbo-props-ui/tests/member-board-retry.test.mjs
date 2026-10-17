import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMemberBoard } from '../src/memberBoardLoad.js';
import { previewForSignedIn } from '../api/data.js';

const sport = { ds: 'nhl_projections', dev: 'nhl/projections.json' };
const noWait = async () => {};
const full = { data: [1, 2], preview: false, lockedCount: 0 };
const preview = { data: [1], preview: true, lockedCount: 539 };

test('full board on the first try is not refetched', async () => {
  const calls = [];
  const out = await loadMemberBoard(sport, async (ds, o) => { calls.push(o); return full; }, noWait);
  assert.equal(out, full);
  assert.equal(calls.length, 1);
});

test('a preview for a member retries once with a fresh token and takes the full board', async () => {
  const calls = [];
  const out = await loadMemberBoard(sport, async (ds, o) => { calls.push(o); return calls.length === 1 ? preview : full; }, noWait);
  assert.equal(out, full);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].fresh, true);
});

test('a preview twice stays a preview (no loop, no fake data)', async () => {
  let n = 0;
  const out = await loadMemberBoard(sport, async () => { n += 1; return preview; }, noWait);
  assert.equal(out, preview);
  assert.equal(n, 2);
});

test('a failed request retries once', async () => {
  let n = 0;
  const out = await loadMemberBoard(sport, async () => { n += 1; if (n === 1) throw new Error('timeout'); return full; }, noWait);
  assert.equal(out, full);
});

test('two failures still surface the error', async () => {
  await assert.rejects(loadMemberBoard(sport, async () => { throw new Error('down'); }, noWait), /down/);
});

test('a preview after a failure is used rather than an error tile', async () => {
  let n = 0;
  const out = await loadMemberBoard(sport, async () => { n += 1; if (n === 1) throw new Error('x'); return preview; }, noWait);
  assert.equal(out, preview);
});

test('a preview sent to a signed-in caller is never browser-cached', () => {
  assert.equal(previewForSignedIn({ headers: { authorization: 'Bearer t' } }, { preview: true }), true);
  assert.equal(previewForSignedIn({ headers: { authorization: 'Bearer t' } }, { preview: false }), false);
  assert.equal(previewForSignedIn({ headers: {} }, { preview: true }), false);
});
