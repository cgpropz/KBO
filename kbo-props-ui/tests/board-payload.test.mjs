import assert from 'node:assert/strict'
import test from 'node:test'
import {
  L10_LIMIT,
  historyForPlayer,
  payloadBytes,
  presentBoardPayload,
  stripBoardHistory,
} from '../api/_boardPayload.js'

function series(n, start = 0) {
  return Array.from({ length: n }, (_, i) => start + i)
}

test('chart arrays keep ten games in publisher order and the other logs stay off', () => {
  const recent = series(15) // oldest → newest
  const recentValues = series(15, 100) // newest first
  const recentGames = series(12).map((points) => ({ date: `2026-09-${points + 1}`, points, log: series(3) }))
  const gameLogs = series(12).map((pts) => ({ date: `10/${pts + 1}/2026`, pts }))
  const board = stripBoardHistory([
    {
      player: 'NFL',
      prop: 'Receiving Yards',
      recent,
      gameDates: series(30).map(String),
      gameOpponents: series(30).map((i) => `T${i}`),
      gameSeasons: series(30).map(() => 2026),
      recentDvpRanks: series(30),
      recentSnapPercents: series(30),
      recentUsage: series(30),
      teammateOn: series(30).map(() => [true]),
      profile: { toi: 40 },
    },
    {
      player: 'NHL',
      prop: 'Shots On Goal',
      recent,
      log: series(82),
      logDates: series(82).map(String),
      logOpponents: series(82).map(String),
      logSeasons: series(82).map(String),
      logTeams: series(82).map(String),
      chartSeasons: series(10).map(String),
      profile: { toi: 18 },
    },
    {
      name: 'WNBA',
      recentGames,
      gameLogs,
      ppAllProps: [{ stat: 'Points', line: 18.5 }],
    },
    {
      name: 'KBO',
      type: 'batter',
      games: series(30).map((h) => ({ h, date: '2026-09-01' })),
      props: [{ stat: 'Hits', line: 1.5, recent_values: recentValues }],
    },
  ])

  assert.deepEqual(board[0].recent, recent.slice(-L10_LIMIT))
  assert.equal(board[0].gameDates, undefined)
  assert.equal(board[0].gameOpponents, undefined)
  assert.equal(board[0].recentUsage, undefined)
  assert.equal(board[0].teammateOn, undefined)
  assert.equal(board[0].profile, undefined)

  assert.deepEqual(board[1].recent, recent.slice(-L10_LIMIT))
  assert.equal(board[1].log, undefined)
  assert.equal(board[1].logDates, undefined)
  assert.equal(board[1].chartSeasons, undefined)
  assert.equal(board[1].profile, undefined)

  assert.deepEqual(board[2].recentGames.map((game) => game.points), recentGames.slice(0, L10_LIMIT).map((game) => game.points))
  assert.equal(board[2].recentGames[0].log, undefined)
  assert.deepEqual(board[2].gameLogs.map((game) => game.pts), gameLogs.slice(0, L10_LIMIT).map((game) => game.pts))

  assert.equal(board[3].games, undefined)
  assert.deepEqual(board[3].props[0].recent_values, recentValues.slice(0, L10_LIMIT))

  const page = historyForPlayer(boardSource(recent, recentValues, recentGames, gameLogs), board, 'nhl')
  assert.equal(page.length, 1)
  assert.deepEqual(page[0].recent, recent)
  assert.deepEqual(page[0].log, series(82))
})

function boardSource(recent, recentValues, recentGames, gameLogs) {
  return [
    { player: 'NFL', recent },
    { player: 'NHL', recent, log: series(82), profile: { toi: 18 } },
    { name: 'WNBA', recentGames, gameLogs },
    { name: 'KBO', type: 'batter', props: [{ recent_values: recentValues }] },
  ]
}

test('a player page still returns the untrimmed log', () => {
  const full = [{
    player: 'T.J. Hughes',
    prop: 'Shots On Goal',
    recent: series(12),
    log: series(40),
    profile: { toi: 12 },
  }]
  const board = presentBoardPayload('', { data: full }, full)
  assert.deepEqual(board[0].recent, series(12).slice(-10))
  assert.equal(board[0].log, undefined)
  assert.equal(board[0].profile, undefined)
  const page = presentBoardPayload('T.J. Hughes', { data: full }, full)
  assert.deepEqual(page[0].recent, series(12))
  assert.deepEqual(page[0].log, series(40))
  assert.equal(page[0].profile.toi, 12)
})

function dropChartGames(data) {
  const keys = new Set(['recent', 'recent_values', 'recentGames', 'gameLogs'])
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      if (keys.has(key)) continue
      out[key] = walk(value)
    }
    return out
  }
  return walk(data)
}

function wnbaGame(index) {
  return {
    date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    matchup: 'ATL vs NYL',
    opponent: 'NYL',
    min: 32.4,
    usagePct: 0.241,
    pts: 18 + (index % 12),
    reb: 7,
    ast: 4,
    fgm: 7,
    fga: 16,
    fg2m: 5,
    fg2a: 9,
    fg3m: 2,
    fg3a: 7,
    ftm: 4,
    fta: 5,
    stl: 1,
    blk: 0,
    blkStl: 1,
    tov: 2,
    oreb: 1,
    dreb: 6,
    fantasy: 36.2,
  }
}

function kboGame(index) {
  return {
    date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    opp: 'KT',
    season: 2026,
    ab: 4,
    h: index % 3,
    r: index % 2,
    rbi: index % 2,
    hr: index % 4 === 0 ? 1 : 0,
    bb: index % 5 === 0 ? 1 : 0,
    sb: 0,
    tb: (index % 3) + (index % 4 === 0 ? 3 : 0),
    so: index % 3 === 0 ? 1 : 0,
  }
}

// Counts from the #169 payload audit. The "before" value is the publisher
// shape. "stripped" deletes every history array, which is what the board
// response did. "kept" is this change: ten chart games, the long logs still gone.
function auditBoards() {
  const nfl = Array.from({ length: 467 }, (_, i) => ({
    player: `Nfl Player ${i}`,
    team: 'DET',
    opponent: 'CHI',
    position: 'WR',
    prop: 'Receiving Yards',
    line: 64.5,
    projection: 71.2,
    line_type: 'standard',
    recent: series(30, i),
    gameDates: series(30).map((n) => `9/${n + 1}`),
    gameOpponents: series(30).map(() => 'CHI'),
    gameSeasons: series(30).map(() => 2026),
    recentDvpRanks: series(30, 1),
    recentSnapPercents: series(30).map((n) => 70 + (n % 20)),
    recentUsage: series(30).map((n) => 4 + (n % 6)),
    teammateOn: series(30).map(() => [true, false, true]),
    hitRate: 60,
    gamesPlayed: 9,
    dvpRank: 12,
  }))
  const nhl = Array.from({ length: 159 }, (_, i) => ({
    player: `Nhl Player ${i}`,
    team: 'COL',
    opponent: 'PIT',
    position: 'F',
    prop: 'Shots On Goal',
    line: 2.5,
    projection: 3.1,
    oddsType: 'standard',
    recent: series(10, i),
    gameDates: series(10).map((n) => `10/${n + 1}`),
    chartSeasons: series(10).map(() => '2026-27'),
    log: series(82, i),
    logDates: series(82).map((n) => `10/${(n % 28) + 1}`),
    logSeasons: series(82).map(() => '2026-27'),
    logOpponents: series(82).map(() => 'PIT'),
    logTeams: series(82).map(() => 'COL'),
    hitRate: 57.1,
    gamesL10: 7,
    profile: {
      toi: 18.4,
      splits: series(6).map((n) => ({ label: `split-${n}`, rate: 0.12, games: 40, note: 'x'.repeat(80) })),
    },
  }))
  const wnba = Array.from({ length: 113 }, (_, i) => ({
    name: `Wnba Player ${i}`,
    team: 'ATL',
    position: 'G',
    gp: 40,
    recentGames: series(40).map((n) => wnbaGame(n + i)),
    ppAllProps: [
      { stat: 'Points', line: 18.5, projection: 21.2, odds_type: 'standard', opponent: 'NYL' },
      { stat: 'Rebounds', line: 6.5, projection: 7.1, odds_type: 'standard', opponent: 'NYL' },
      { stat: 'Assists', line: 4.5, projection: 5.4, odds_type: 'standard', opponent: 'NYL' },
    ],
  }))
  const kbo = {
    generated_at: '2026-10-16T12:00:00Z',
    cards: Array.from({ length: 30 }, (_, c) => ({
      name: `Kbo Player ${c}`,
      team: 'LG',
      opponent: 'KT',
      type: c % 2 ? 'batter' : 'pitcher',
      games: series(30).map((n) => kboGame(n)),
      props: Array.from({ length: 4 }, (_, p) => ({
        stat: `Stat ${p}`,
        line: 1.5,
        projection: 1.8,
        odds_type: 'standard',
        recent_values: series(10, c + p),
        hit_rate_l10: 60,
      })),
    })),
  }
  return { nfl, nhl, wnba, kbo }
}

test('keeping ten chart games adds a small slice next to the stripped log', () => {
  const boards = auditBoards()
  const report = {}
  for (const [name, full] of Object.entries(boards)) {
    const kept = stripBoardHistory(full)
    const stripped = dropChartGames(kept)
    const fullBytes = payloadBytes(full)
    const keptBytes = payloadBytes(kept)
    const strippedBytes = payloadBytes(stripped)
    report[name] = {
      fullBytes,
      keptBytes,
      strippedBytes,
      addedBytes: keptBytes - strippedBytes,
      addedPct: Number((((keptBytes - strippedBytes) / strippedBytes) * 100).toFixed(1)),
    }
    assert.ok(report[name].addedBytes > 0)
    assert.ok(report[name].keptBytes < fullBytes)
  }
  // The long logs stay off. Ten numbers (NFL, NHL, KBO) or ten game objects
  // (WNBA) are the whole increase versus deleting the chart arrays.
  assert.ok(report.nfl.addedBytes < 40_000, JSON.stringify(report.nfl))
  assert.ok(report.nhl.addedBytes < 25_000, JSON.stringify(report.nhl))
  assert.ok(report.kbo.addedBytes < 20_000, JSON.stringify(report.kbo))
  assert.ok(report.wnba.addedBytes < 400_000, JSON.stringify(report.wnba))
  assert.ok(report.wnba.keptBytes < report.wnba.fullBytes * 0.85, JSON.stringify(report.wnba))
  // #169 measured the stripped member boards. The added bytes above are the
  // chart arrays only, so the percent is against those stripped sizes.
  const auditStripped = { nfl: 455 * 1024, nhl: 59 * 1024, wnba: 2 * 1024 * 1024, kbo: 5 * 1024 }
  for (const name of Object.keys(report)) {
    report[name].auditStrippedBytes = auditStripped[name]
    report[name].auditAddedPct = Number(((report[name].addedBytes / auditStripped[name]) * 100).toFixed(1))
  }
  console.log(JSON.stringify(report, null, 2))
})

test('nhlApiLog leaves the server only with NHL_API_SECTIONS_SERVER=1', () => {
  const full = [
    { player: 'Synth Center', prop: 'Shots On Goal', line: 2.5, oddsType: 'standard', nhlApiLog: { v: 1, games: [[1]] } },
    { player: 'Synth Center', prop: 'Points', line: 0.5, oddsType: 'standard' },
  ]
  const off = presentBoardPayload('Synth Center', { data: full }, full, { env: {} })
  assert.equal(off.length, 2)
  assert.ok(off.every((row) => !('nhlApiLog' in row)))
  assert.equal(off[0].line, 2.5)
  const wrong = presentBoardPayload('Synth Center', { data: full }, full, { env: { NHL_API_SECTIONS_SERVER: 'true' } })
  assert.ok(wrong.every((row) => !('nhlApiLog' in row)))
  const on = presentBoardPayload('Synth Center', { data: full }, full, { env: { NHL_API_SECTIONS_SERVER: '1' } })
  assert.deepEqual(on[0].nhlApiLog, { v: 1, games: [[1]] })
  const board = presentBoardPayload('', { data: full }, full, { env: { NHL_API_SECTIONS_SERVER: '1' } })
  assert.ok(board.every((row) => !('nhlApiLog' in row)))
})

test('withoutNhlApiLog handles a row object as well as an array', async () => {
  const { withoutNhlApiLog } = await import('../api/_boardPayload.js')
  assert.deepEqual(withoutNhlApiLog({ player: 'Test Skater', nhlApiLog: { v: 1 } }), { player: 'Test Skater' })
  assert.deepEqual(withoutNhlApiLog([{ player: 'A', nhlApiLog: {} }, { player: 'B' }]), [{ player: 'A' }, { player: 'B' }])
  const plain = { player: 'C' }
  assert.equal(withoutNhlApiLog(plain), plain)
  assert.equal(withoutNhlApiLog(null), null)
})
