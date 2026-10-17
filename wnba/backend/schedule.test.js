const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('./schedule');
const PP_STAT_MAP = require('./ppStatMap');

const normalize = value => {
  const upper = String(value || '').trim().toUpperCase();
  return { 'GOLDEN STATE VALKYRIES': 'GSV', 'ATLANTA DREAM': 'ATL' }[upper] || upper || null;
};

// ESPN scoreboard shape: Finals G1 final Sat 3:30 PM ET, G2 Mon 8:00 PM ET.
const G1 = {
  id: '1', date: '2026-10-17T19:30Z',
  status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'GS', displayName: 'Golden State Valkyries' } },
    { homeAway: 'away', team: { abbreviation: 'ATL', displayName: 'Atlanta Dream' } },
  ] }],
};
const G2 = {
  id: '2', date: '2026-10-20T00:00Z',
  status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'GS', displayName: 'Golden State Valkyries' } },
    { homeAway: 'away', team: { abbreviation: 'ATL', displayName: 'Atlanta Dream' } },
  ] }],
};
const EVENTS = schedule.mergeEvents([
  schedule.parseScoreboard({ events: [G1] }, normalize),
  schedule.parseScoreboard({ events: [G2] }, normalize),
]);
// Sat Oct 17, 7:00 PM ET.
const NOW = new Date('2026-10-17T23:00:00Z');

test('parseScoreboard maps ESPN teams, ET dates and status', () => {
  assert.equal(EVENTS.length, 2);
  assert.deepEqual(EVENTS.map(e => [e.away, e.home, e.gameDate, e.state, e.completed]), [
    ['ATL', 'GSV', '2026-10-17', 'post', true],
    ['ATL', 'GSV', '2026-10-19', 'pre', false],
  ]);
  assert.equal(schedule.etTimeLabel(EVENTS[1].startTime), '8:00 PM ET');
});

test('a prop from the finished game is started; the next game is not', () => {
  const g1 = { stat: 'Points', line: 18.5, opponent: 'ATL', gameDate: '2026-10-17' };
  const g2 = { stat: 'Points', line: 18.5, opponent: 'ATL', gameDate: '2026-10-19' };
  const options = { events: EVENTS, team: 'GSV', now: NOW, normalizeTeamAbbr: normalize };
  assert.equal(schedule.propHasStarted(g1, options), true);
  assert.equal(schedule.propHasStarted(g2, options), false);
});

test('without a schedule, start_time decides, then an earlier game date', () => {
  const now = NOW;
  assert.equal(schedule.propHasStarted({ gameDate: '2026-10-17', start_time: '2026-10-17T19:30:00Z' }, { now }), true);
  assert.equal(schedule.propHasStarted({ gameDate: '2026-10-17', start_time: '2026-10-17T23:30:00Z' }, { now }), false);
  assert.equal(schedule.propHasStarted({ gameDate: '2026-10-16' }, { now }), true);
  // Same day, no start time, no schedule: not enough to call it started.
  assert.equal(schedule.propHasStarted({ gameDate: '2026-10-17', opponent: 'ATL' }, { now }), false);
  // A start time without a zone is ignored, never guessed.
  assert.equal(schedule.propHasStarted({ gameDate: '2026-10-17', start_time: '2026-10-17T15:30:00' }, { now }), false);
});

test('dropStartedLines removes finished props and their stat keys', () => {
  const lines = {
    'Finished Player': {
      pts: 18.5,
      __allProps: [{ stat: 'Points', line: 18.5, opponent: 'ATL', gameDate: '2026-10-17' }],
    },
    'Next Game Player': {
      reb: 6.5,
      __allProps: [{ stat: 'Rebounds', line: 6.5, opponent: 'GSV', gameDate: '2026-10-19' }],
    },
  };
  const { lines: kept, dropped } = schedule.dropStartedLines(lines, {
    events: EVENTS, now: NOW, statMap: PP_STAT_MAP, normalizeTeamAbbr: normalize,
    teamByName: { 'Finished Player': 'GSV', 'Next Game Player': 'ATL' },
  });
  assert.equal(dropped, 1);
  assert.deepEqual(Object.keys(kept), ['Next Game Player']);
  assert.equal(kept['Next Game Player'].reb, 6.5);
  // The kept prop gets the schedule start so publish-time expiry drops it at tip.
  assert.equal(kept['Next Game Player'].__allProps[0].start_time, '2026-10-20T00:00:00.000Z');
});

test('dropStartedProjectionProps keeps rows, drops finished props, leaves projections alone', () => {
  const rows = [
    {
      name: 'A', team: 'GSV', projPts: 17.2, ppLines: { pts: 18.5, reb: 5.5 },
      ppAllProps: [
        { stat: 'Points', line: 18.5, projection: 17.2, rating: 46.5, opponent: 'ATL', gameDate: '2026-10-17' },
        { stat: 'Rebounds', line: 5.5, projection: 6.1, rating: 55.5, opponent: 'ATL', gameDate: '2026-10-17' },
      ],
    },
    {
      name: 'B', team: 'ATL', projPts: 20.1, ppLines: { pts: 19.5 },
      ppAllProps: [{ stat: 'Points', line: 19.5, projection: 20.1, rating: 51.5, opponent: 'GSV', gameDate: '2026-10-19' }],
    },
    { name: 'C', team: 'ATL', ppAllProps: [] },
  ];
  const { rows: out, dropped } = schedule.dropStartedProjectionProps(rows, {
    events: EVENTS, now: NOW, statMap: PP_STAT_MAP, normalizeTeamAbbr: normalize,
  });
  assert.equal(dropped, 2);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].ppAllProps, []);
  assert.deepEqual(out[0].ppLines, { pts: null, reb: null });
  assert.equal(out[0].projPts, 17.2);
  assert.equal(out[1].ppAllProps[0].projection, 20.1);
  assert.equal(out[1].ppAllProps[0].rating, 51.5);
  assert.equal(out[1].ppAllProps[0].start_time, '2026-10-20T00:00:00.000Z');
  assert.equal(out[2], rows[2]);
});

const LINEUP = (gameTime) => ({
  gameTime,
  visitor: { abbr: 'ATL', players: [{ name: 'Rhyne Howard' }], inactive: [] },
  home: { abbr: 'GSV', players: [{ name: 'Kate Martin' }], inactive: [] },
});

test('lineup with no tip time gets the next scheduled game time', () => {
  const [game] = schedule.attachScheduleTimes([LINEUP('')], EVENTS, NOW);
  assert.equal(game.gameTime, '8:00 PM ET');
  assert.equal(game.gameDate, '2026-10-19');
  assert.equal(game.startTime, '2026-10-20T00:00:00.000Z');
  assert.equal(game.gameTimeSource, 'schedule');
});

test('lineup still listing the finished game moves to the next scheduled game', () => {
  const [game] = schedule.attachScheduleTimes([LINEUP('3:30 PM ET')], EVENTS, NOW);
  assert.equal(game.gameTime, '8:00 PM ET');
  assert.equal(game.gameDate, '2026-10-19');
  assert.equal(game.gameTimeSource, 'schedule');
  assert.equal(game.listedGameTime, '3:30 PM ET');
  assert.equal(game.lineupFromFinishedGame, true);
  assert.deepEqual(game.visitor.players, [{ name: 'Rhyne Howard' }]);
});

test('lineup time is never invented without a schedule event', () => {
  const empty = LINEUP('');
  assert.equal(schedule.attachScheduleTimes([empty], [], NOW)[0], empty);
  const otherPair = { ...LINEUP(''), visitor: { abbr: 'NYL', players: [], inactive: [] } };
  assert.equal(schedule.attachScheduleTimes([otherPair], EVENTS, NOW)[0], otherPair);
  // Only the finished game on the schedule: nothing upcoming to copy.
  const onlyG1 = EVENTS.filter(e => e.completed);
  assert.equal(schedule.attachScheduleTimes([empty], onlyG1, NOW)[0], empty);
});

test('lineup feed time for the upcoming game is kept and dated', () => {
  const monday = new Date('2026-10-19T16:00:00Z');
  const [game] = schedule.attachScheduleTimes([LINEUP('8:00 PM ET')], EVENTS, monday);
  assert.equal(game.gameTime, '8:00 PM ET');
  assert.equal(game.gameTimeSource, 'rotowire');
  assert.equal(game.startTime, '2026-10-20T00:00:00.000Z');
});
