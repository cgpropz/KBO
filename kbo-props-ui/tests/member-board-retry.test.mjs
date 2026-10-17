import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FETCH_BUDGET_MS, loadHubSports, loadMemberBoard, retryDelayWithin } from '../src/memberBoardLoad.js';
import { readOpenFlag } from '../src/openFlag.js';
import { previewForSignedIn } from '../api/data.js';

const apiSource = readFileSync(new URL('../src/apiData.js', import.meta.url), 'utf8');
const hubSource = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8');

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

test('retries back off and stay inside the 12s fetch budget', () => {
  assert.equal(retryDelayWithin(0, 0), 800);
  assert.equal(retryDelayWithin(1, 0), 1600);
  assert.equal(retryDelayWithin(2, 0), 3200);
  assert.equal(retryDelayWithin(0, 8_000, FETCH_BUDGET_MS), 800);
  assert.equal(retryDelayWithin(0, 11_000, FETCH_BUDGET_MS), null);
  assert.equal(FETCH_BUDGET_MS, 12_000);
  assert.match(apiSource, /export const FETCH_TIMEOUT_MS = 12_000/);
});

test('a slow first answer is kept when a retry would miss the budget', async () => {
  let t = 0;
  let calls = 0;
  const out = await loadMemberBoard(sport, async () => {
    calls += 1;
    t = 11_000;
    return preview;
  }, async () => { throw new Error('should not retry'); }, { now: () => t });
  assert.equal(out, preview);
  assert.equal(calls, 1);
});

test('a slow failure does not start a retry that cannot finish', async () => {
  let t = 0;
  let calls = 0;
  await assert.rejects(loadMemberBoard(sport, async () => {
    calls += 1;
    t = 11_000;
    throw new Error('slow');
  }, async () => { throw new Error('should not retry'); }, { now: () => t }), /slow/);
  assert.equal(calls, 1);
});

test('the first retry still waits 800ms when the attempt was fast', async () => {
  const waits = [];
  const calls = [];
  const out = await loadMemberBoard(sport, async (ds, opts) => {
    calls.push(opts);
    return calls.length === 1 ? preview : full;
  }, async (ms) => { waits.push(ms); });
  assert.equal(out, full);
  assert.deepEqual(waits, [800]);
  assert.equal(calls[1].fresh, true);
  assert.ok(calls[0].timeoutMs <= FETCH_BUDGET_MS);
});

test('a slow or failed sport does not block the others', async () => {
  const sports = [{ id: 'kbo' }, { id: 'wnba' }, { id: 'nfl' }, { id: 'nhl' }];
  const finished = [];
  await loadHubSports(sports, 'nhl', async (sport) => {
    if (sport.id === 'kbo') await new Promise((resolve) => setTimeout(resolve, 40));
    finished.push(sport.id);
  });
  assert.equal(finished.length, 4);
  assert.ok(finished.indexOf('nhl') < finished.indexOf('kbo'));
  assert.ok(finished.includes('wnba'));
  assert.ok(finished.includes('nfl'));

  const settled = [];
  await loadHubSports([{ id: 'kbo' }, { id: 'nhl' }], 'nhl', async (sport) => {
    if (sport.id === 'kbo') throw new Error('503');
    settled.push(sport.id);
  });
  assert.deepEqual(settled, ['nhl']);
});

test('a hung board request settles as an error inside the budget', async () => {
  let calls = 0;
  await assert.rejects(loadMemberBoard(sport, () => {
    calls += 1;
    return new Promise(() => {});
  }, noWait, { budgetMs: 40 }), /timed out/);
  assert.equal(calls, 1);
});

test('an open-hook retry fits after an 8s miss and a slow answer is kept', async () => {
  let t = 0;
  const calls = [];
  const open = await readOpenFlag('/api/nhl-access', {
    now: () => t,
    wait: async (ms) => { t += ms; },
    fetchImpl: async (_url, init) => {
      calls.push({ t, timeout: init.signal });
      if (calls.length === 1) {
        t += 8_000;
        throw new Error('timeout');
      }
      t += 100;
      return { ok: true, json: async () => ({ open: true }) };
    },
  });
  assert.equal(open, true);
  assert.equal(calls.length, 2);
  assert.ok(t <= FETCH_BUDGET_MS);

  t = 0;
  let late = 0;
  const kept = await readOpenFlag('/api/nba-access', {
    now: () => t,
    wait: async () => { throw new Error('should not retry'); },
    fetchImpl: async () => {
      late += 1;
      t = 11_000;
      return { ok: true, json: async () => ({ open: true }) };
    },
  });
  assert.equal(kept, true);
  assert.equal(late, 1);
});

test('an error tile shows a retry instead of staying on Loading', () => {
  assert.match(hubSource, /className="hub-retry"/);
  assert.match(hubSource, /Couldn\\'t load · Retry/);
  assert.match(hubSource, /retrySport\(sport\.id\)/);
});

test('a preview sent to a signed-in caller is never browser-cached', () => {
  assert.equal(previewForSignedIn({ headers: { authorization: 'Bearer t' } }, { preview: true }), true);
  assert.equal(previewForSignedIn({ headers: { authorization: 'Bearer t' } }, { preview: false }), false);
  assert.equal(previewForSignedIn({ headers: {} }, { preview: true }), false);
});
