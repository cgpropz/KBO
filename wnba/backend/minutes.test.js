const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalGameDate, minutesWindowGames, projectionAvgMins } = require('./minutes');

const reg = (date, min) => ({ date, min });
const post = (date, min) => ({ date, min, postseason: true });

// 12 regular-season games, Aug 20 .. Sep 10 (scraped M/D/YYYY dates), 32 min each.
const REGULAR = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 20 + i * 2));
  return reg(`${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/2026`, 32);
});

test('postseason / Finals games are counted in avgMins', () => {
  const finals = [post('10/17/2026', 22), post('10/19/2026', 24)];
  const logs = [...REGULAR, ...finals];
  // Last 10 by date = 2 Finals games + 8 newest regular-season games.
  assert.equal(projectionAvgMins(logs), (22 + 24 + 8 * 32) / 10);
  assert.notEqual(projectionAvgMins(logs), projectionAvgMins(REGULAR));
});

test('window is the last 10 games in date order, across both seasons and date formats', () => {
  const logs = [
    post('2026-10-19T00:00:00', 20),
    reg('09/10/2026', 30),
    post('09/24/2026', 25),
    reg('2026-09-08T00:00:00', 35),
    ...REGULAR.slice(0, 10),
  ];
  const window = minutesWindowGames(logs);
  assert.equal(window.length, 10);
  const dates = window.map(g => canonicalGameDate(g.date));
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  assert.equal(dates[0], '2026-10-19');
  assert.equal(dates[1], '2026-09-24');
  // Input order does not matter.
  assert.equal(projectionAvgMins([...logs].reverse()), projectionAvgMins(logs));
  // Older games fall out once 10 newer ones exist.
  assert.ok(!dates.includes('2026-08-20'));
});

test('a player with no postseason games is unchanged (plain mean of last 10 regular-season games)', () => {
  const varied = REGULAR.map((g, i) => ({ ...g, min: 20 + i }));
  const newestFirst = [...varied].sort((a, b) => canonicalGameDate(b.date).localeCompare(canonicalGameDate(a.date)));
  const legacy = newestFirst.slice(0, 10).reduce((s, g) => s + g.min, 0) / 10;
  assert.equal(projectionAvgMins(varied), legacy);
});

test('fewer than 10 games averages what exists; no games is 0', () => {
  assert.equal(projectionAvgMins([reg('09/01/2026', 30), post('10/17/2026', 20)]), 25);
  assert.equal(projectionAvgMins([]), 0);
  assert.equal(projectionAvgMins(undefined), 0);
});

test('both projection routes take minutes from the postseason-inclusive log', () => {
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const uses = src.match(/const avgMins\s+= projectionAvgMins\(logGames\);/g) || [];
  assert.equal(uses.length, 2, '/api/projections/v2 and /api/edge');
  assert.ok(!/last10\.reduce\(\(s, g\) => s \+ g\.min, 0\) \/ last10\.length;\n\s+const dvpFactors/.test(src));
});
