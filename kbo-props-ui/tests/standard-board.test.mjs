import assert from 'node:assert/strict'
import test from 'node:test'
import { FILTER_STANDARD_BEFORE_FREE_PREVIEW, selectFreeSharpOddsPreview, shapeForTier } from '../api/_dataAccess.js'
import { filterNhlSharpOdds, filterStandardBoard, isStandardBoardLine, nhlSharpMatchedType, nhlProjectionOddsById, rawOddsType } from '../src/standardBoard.js'

test('raw odds type keeps unknown tokens and blank stays empty', () => {
  assert.equal(rawOddsType({ odds_type: ' Goblin ' }), 'goblin')
  assert.equal(rawOddsType({ oddsType: 'DEMON' }), 'demon')
  assert.equal(rawOddsType({ line_type: 'standard' }), 'standard')
  assert.equal(rawOddsType({ lineType: 'mystery' }), 'mystery')
  assert.equal(rawOddsType({ odds_type: '  ' }), '')
  assert.equal(rawOddsType({}), '')
  assert.equal(isStandardBoardLine({ oddsType: 'standard' }), true)
  assert.equal(isStandardBoardLine({}), true)
  assert.equal(isStandardBoardLine({ odds_type: null }), true)
  assert.equal(isStandardBoardLine({ odds_type: '  ' }), false)
  assert.equal(isStandardBoardLine({ odds_type: 'goblin' }), false)
  assert.equal(isStandardBoardLine({ oddsType: 'demon' }), false)
})

test('NHL and NFL boards keep a row with no odds type and drop goblin and demon', () => {
  const nhl = [
    { player: 'A', oddsType: 'standard' },
    { player: 'B', oddsType: 'goblin' },
    { player: 'C', oddsType: 'demon' },
    { player: 'D' },
    { player: 'E', oddsType: 'mystery' },
  ]
  const filtered = filterStandardBoard('nhl_projections', nhl)
  assert.deepEqual(filtered.map((row) => row.player), ['A', 'D'])
  assert.equal(nhl.length, 5)

  const nfl = filterStandardBoard('nfl_projections', [
    { player: 'Std', line_type: 'standard' },
    { player: 'Gob', line_type: 'goblin' },
    { player: 'Blank' },
  ])
  assert.deepEqual(nfl.map((row) => row.player), ['Std', 'Blank'])
})

test('KBO cards and pitcher lists keep a row with no odds type', () => {
  const board = {
    total_props: 3,
    cards: [{
      name: 'Kim',
      props: [
        { stat: 'Hits', odds_type: 'standard' },
        { stat: 'Hits', odds_type: 'goblin' },
        { stat: 'Hits' },
      ],
    }, {
      name: 'Promo Only',
      props: [{ stat: 'Strikeouts', odds_type: 'demon' }],
    }],
  }
  const next = filterStandardBoard('prizepicks_props', board)
  assert.deepEqual(next.cards.map((card) => card.name), ['Kim'])
  assert.equal(next.cards[0].props.length, 2)
  assert.equal(next.total_props, 2)
  assert.equal(board.cards[0].props.length, 3)

  const pitchers = filterStandardBoard('strikeout_projections', {
    projections: [
      { name: 'A', odds_type: 'standard' },
      { name: 'B', odds_type: 'goblin' },
      { name: 'C' },
    ],
  })
  assert.deepEqual(pitchers.projections.map((row) => row.name), ['A', 'C'])
})

test('WNBA and NBA standard feeds treat a missing type as standard and drop promos', () => {
  const players = [
    { name: 'Standard', ppAllProps: [{ stat: 'Points', line: 20 }] },
    { name: 'Mixed', ppAllProps: [{ stat: 'Points', odds_type: 'standard' }, { stat: 'Rebounds', odds_type: 'demon' }] },
    { name: 'Goblin', ppAllProps: [{ stat: 'Assists', oddsType: 'goblin' }] },
  ]
  const kept = filterStandardBoard('wnba_projections_standard', players)
  assert.deepEqual(kept.map((player) => player.name), ['Standard', 'Mixed'])
  assert.equal(kept[1].ppAllProps.length, 1)
  assert.equal(players[1].ppAllProps.length, 2)

  const promo = filterStandardBoard('nba_projections_goblin', players)
  assert.deepEqual(promo.map((player) => player.name), ['Standard', 'Mixed'])
  assert.equal(promo[0].ppAllProps.length, 1)
  assert.equal(promo[1].ppAllProps.length, 1)
  assert.equal(promo[1].ppAllProps[0].odds_type, 'standard')
  const unlabeled = [{ name: 'Blank', ppAllProps: [{ stat: 'Points', line: 10 }] }]
  assert.deepEqual(filterStandardBoard('wnba_projections_demon', unlabeled), unlabeled)
  const demon = shapeForTier('wnba_projections_demon', unlabeled, 'combined')
  assert.equal(demon.preview, false)
  assert.equal(demon.data[0].name, 'Blank')
  assert.equal(demon.data[0].ppAllProps.length, 1)
})

test('the paid NHL board and the free preview keep standard lines only', () => {
  assert.equal(FILTER_STANDARD_BEFORE_FREE_PREVIEW, true)
  const rows = [
    { player: 'Goblin', prop: 'Points', line: 0.5, projection: 2, oddsType: 'goblin', rankEligible: true },
    { player: 'Standard', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', rankEligible: true },
    { player: 'Missing', prop: 'Shots On Goal', line: 2.5, projection: 3, rankEligible: true },
    { player: 'Unknown', prop: 'Shots On Goal', line: 2.5, projection: 4, oddsType: 'alt', rankEligible: true },
  ]
  const paid = shapeForTier('nhl_projections', rows, 'combined')
  assert.equal(paid.preview, false)
  assert.deepEqual(paid.data.map((row) => row.player), ['Standard', 'Missing'])
  const free = shapeForTier('nhl_projections', rows, 'free')
  assert.equal(free.preview, true)
  assert.deepEqual(free.data.map((row) => row.player), ['Standard', 'Missing'])
  assert.equal(free.lockedCount, 0)
  assert.equal(rows.length, 4)
})

test('paid graded history keeps a row with no odds type and the summary matches', () => {
  const history = {
    summary: { hits: 99, misses: 99, total_graded: 99 },
    graded: [
      { player: 'Hit', result: 'HIT', type: 'OVER', stat: 'K', role: 'pitcher', edge: 2, odds_type: 'standard' },
      { player: 'Miss', result: 'MISS', type: 'UNDER', stat: 'HA', role: 'pitcher', edge: 4, odds_type: 'goblin' },
      { player: 'Demon', result: 'HIT', type: 'OVER', stat: 'K', role: 'batter', edge: 10, odds_type: 'demon' },
      { player: 'Plain', result: 'HIT', type: 'OVER', stat: 'TB', role: 'batter', edge: 6 },
    ],
    pending: [
      { player: 'Open', odds_type: 'goblin' },
      { player: 'Stay' },
    ],
  }
  const paid = shapeForTier('graded_props_history', history, 'combined')
  assert.equal(paid.preview, false)
  assert.deepEqual(paid.data.graded.map((row) => row.player), ['Hit', 'Plain'])
  assert.deepEqual(paid.data.pending.map((row) => row.player), ['Stay'])
  assert.equal(paid.data.summary.hits, 2)
  assert.equal(paid.data.summary.misses, 0)
  assert.equal(paid.data.summary.total_graded, 2)
  assert.equal(paid.data.summary.total_pending, 1)
  assert.equal(paid.data.summary.overall_hit_rate, 100)
  assert.equal(paid.data.summary.over_volume, 2)
  assert.equal(paid.data.summary.under_volume, 0)
  assert.equal(paid.data.summary.avg_edge, 4)
  assert.equal(paid.data.summary.by_stat.K.hits, 1)
  assert.equal(paid.data.summary.by_role.batter.hits, 1)
  assert.equal(history.summary.hits, 99)
  assert.equal(history.graded.length, 4)

  const unlabeled = {
    summary: { hit: 10 },
    graded: [{ id: 1 }, { id: 2 }],
    pending: [{ id: 3 }, { id: 4 }],
  }
  const kept = shapeForTier('graded_props_history', unlabeled, 'combined')
  assert.equal(kept.data.summary, unlabeled.summary)
  assert.equal(kept.data.graded.length, 2)
  assert.equal(kept.data.pending.length, 2)
})

test('a player with an empty prop list stays on the standard board', () => {
  const players = [{ name: 'Empty', ppAllProps: [] }]
  assert.equal(filterStandardBoard('wnba_projections_standard', players), players)
  assert.equal(filterStandardBoard('nba_projections_standard', players), players)
})

test('a paid WNBA standard board keeps all 224 players when most lists are empty', () => {
  const players = Array.from({ length: 224 }, (_, i) => (
    i < 13
      ? { name: `P${i}`, ppAllProps: [{ stat: 'Points', line: 10 + i }] }
      : { name: `P${i}`, ppAllProps: [] }
  ))
  players.push({ name: 'Goblin Only', ppAllProps: [{ stat: 'Assists', odds_type: 'goblin' }] })
  const paid = shapeForTier('wnba_projections_standard', players, 'combined')
  assert.equal(paid.preview, false)
  assert.equal(paid.data.length, 224)
  assert.equal(paid.data.filter((player) => player.ppAllProps.length > 0).length, 13)
  assert.equal(paid.data.some((player) => player.name === 'Goblin Only'), false)
  assert.equal(players.length, 225)
})

test('NHL sharp odds keep a row only when its id matches a standard projection', () => {
  const projections = [
    { id: 100, player: 'Standard', oddsType: 'standard' },
    { id: 101, player: 'Plain' },
    { id: 15856898, player: 'Ekblad', oddsType: 'demon' },
    { id: 15857300, player: 'Newhook', oddsType: 'demon' },
    { id: 15857317, player: 'Texier', oddsType: 'demon' },
  ]
  const odds = {
    message: 'matched',
    records: [
      { id: 100, player: 'Standard', line_type: null, pp_edge_flex: 1 },
      { id: 101, player: 'Plain', line_type: null, pp_edge_flex: 1 },
      { id: 15856898, player: 'Ekblad', prop: 'Power Play Points', line_type: null, pp_edge_flex: 50 },
      { id: 15857300, player: 'Newhook', prop: 'Power Play Points', line_type: null, pp_edge_flex: 40 },
      { id: 15857317, player: 'Texier', prop: 'Power Play Points', line_type: null, pp_edge_flex: 30 },
      { id: 999, player: 'Unknown', line_type: null, pp_edge_flex: 20 },
      { player: 'NoId', line_type: null, pp_edge_flex: 15 },
    ],
  }
  const types = nhlProjectionOddsById(projections)
  assert.equal(nhlSharpMatchedType(odds.records[0], types), 'standard')
  assert.equal(nhlSharpMatchedType(odds.records[2], types), 'demon')
  assert.equal(nhlSharpMatchedType(odds.records[5], types), 'unknown')
  const kept = filterNhlSharpOdds(odds, projections)
  assert.deepEqual(kept.records.map((row) => row.id), [100, 101])
  assert.equal(kept.message, 'matched')
  assert.equal(odds.records.length, 7)
})

test('NHL sharp odds drop a standard id PrizePicks has pulled', () => {
  const projections = [
    { id: 100, player: 'Live', prop: 'Shots On Goal', line: 2.5, projection: 3.1, oddsType: 'standard' },
    { id: 15863634, player: 'Pulled', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', removed: true, pp_status: 'removed' },
    { id: 101, player: 'Status', prop: 'Shots On Goal', line: 2.5, projection: 3, oddsType: 'standard', pp_status: 'removed' },
    { id: 102, player: 'Low', prop: 'Points', line: 0.5, projection: 0.5, oddsType: 'standard' },
    { id: 103, player: 'Under', prop: 'Points', line: 0.5, projection: 0.4, oddsType: 'standard' },
    { id: 104, player: 'Held', prop: 'Points', line: 0.5, projection: 0.74, oddsType: 'standard' },
    { id: 105, player: 'Goalie', prop: 'Goalie Saves', line: 28.5, projection: 30, oddsType: 'standard', rankEligible: false },
  ]
  const odds = {
    message: 'matched',
    records: projections.map((row) => ({ id: row.id, player: row.player, line_type: null, pp_edge_flex: 1 })),
  }
  const kept = filterNhlSharpOdds(odds, projections)
  assert.deepEqual(kept.records.map((row) => row.id), [100, 103])
  assert.equal(kept.records.some((row) => row.id === 15863634 || row.id === 104 || row.id === 105), false)
  assert.equal(odds.records.length, 7)
})

test('NHL sharp odds apply the pulled and rankable checks to a Map of rows', () => {
  const projections = new Map([
    [100, { id: 100, player: 'Live', prop: 'Shots On Goal', line: 2.5, projection: 3.1, oddsType: 'standard' }],
    [15863634, { player: 'Pulled', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', removed: true, pp_status: 'removed' }],
    [104, { id: 104, player: 'Held', prop: 'Points', line: 0.5, projection: 0.74, oddsType: 'standard' }],
    [105, { id: 105, player: 'Goalie', prop: 'Goalie Saves', line: 28.5, projection: 30, oddsType: 'standard', rankEligible: false }],
  ])
  const kept = filterNhlSharpOdds({
    records: [100, 15863634, 104, 105].map((id) => ({ id, line_type: null })),
  }, projections)
  assert.deepEqual(kept.records.map((row) => row.id), [100])
})

test('NFL and NHL sharp odds drop goblin and demon and keep a row with no odds type', () => {
  const records = [
    { player: 'Std', odds_type: 'standard', ev_pct: 4 },
    { player: 'Gob', odds_type: 'goblin', ev_pct: 9 },
    { player: 'Dem', oddsType: 'demon', ev_pct: 8 },
    { player: 'Plain', ev_pct: 1 },
    { player: 'Blank', odds_type: '  ', ev_pct: 2 },
  ]
  for (const ds of ['nfl_sharp_odds', 'nhl_sharp_odds']) {
    const next = filterStandardBoard(ds, { records, message: 'matched' })
    assert.deepEqual(next.records.map((row) => row.player), ['Std', 'Plain'], ds)
    assert.equal(next.message, 'matched')
    const paid = shapeForTier(ds, { records, message: 'matched' }, 'combined')
    assert.equal(paid.preview, false)
    assert.deepEqual(paid.data.records.map((row) => row.player), ['Std', 'Plain'], ds)
    assert.equal(paid.data.message, 'matched')
  }
  assert.equal(records.length, 5)
})

test('free sharp odds preview keeps an exact line or a nearest half point', () => {
  const records = [
    { player: 'Far', prop: 'Receiving Yards', recommendation: 'OVER', pp_line: 70, matched_line: 74.5, line_match: 'nearest', pp_edge_flex: 40, line_type: 'standard' },
    { player: 'Point', prop: 'Pts+Asts', recommendation: 'OVER', pp_line: 19.5, matched_line: 20.5, line_match: 'nearest', pp_edge_flex: 50, line_type: 'standard' },
    { player: 'Half', prop: 'Receiving Yards', recommendation: 'OVER', pp_line: 74, matched_line: 74.5, line_match: 'nearest', pp_edge_flex: 3, line_type: 'standard' },
    { player: 'Exact', prop: 'Receiving Yards', recommendation: 'UNDER', pp_line: 74.5, matched_line: 74.5, line_match: 'exact', pp_edge_flex: 2, line_type: 'standard' },
    { player: 'None', prop: 'Receiving Yards', recommendation: 'OVER', pp_line: 74.5, line_match: 'none', pp_edge_flex: 30, line_type: 'standard' },
    { player: 'Other', prop: 'Rush Yards', recommendation: 'OVER', pp_line: 50.5, matched_line: 50, line_match: 'nearest', pp_edge_flex: 1, line_type: 'standard' },
  ]
  for (const sport of ['nfl', 'nhl']) {
    const picked = selectFreeSharpOddsPreview(records, sport)
    assert.deepEqual(picked.map((row) => row.player), ['Half', 'Exact', 'Other'], sport)
    assert.equal(picked[1].side, 'UNDER')
    assert.equal(picked.some((row) => row.player === 'Far' || row.player === 'Point' || row.player === 'None'), false)
  }
  const payload = { records, message: 'matched' }
  for (const ds of ['nfl_sharp_odds', 'nhl_sharp_odds']) {
    const paid = shapeForTier(ds, payload, 'combined')
    assert.equal(paid.preview, false)
    assert.deepEqual(paid.data.records.map((row) => row.player), ['Far', 'Point', 'Half', 'Exact', 'None', 'Other'], ds)
    const free = shapeForTier(ds, payload, 'free')
    assert.equal(free.preview, true)
    assert.deepEqual(free.data.records.map((row) => row.player), ['Half', 'Exact', 'Other'], ds)
    assert.equal(free.lockedCount, 3)
  }
})

test('free sharp odds preview skips an exact line with no edge', () => {
  const records = [
    { player: 'NoEdge', prop: 'Receiving Yards', recommendation: 'UNDER', pp_line: 40.5, matched_line: 40.5, line_match: 'exact', pp_edge_flex: null, pp_edge_pct: null, ev_pct: null, line_type: 'standard' },
    { player: 'Low', prop: 'Receiving Yards', recommendation: 'UNDER', pp_line: 30.5, matched_line: 30.5, line_match: 'exact', pp_edge_flex: -8, line_type: 'standard' },
    { player: 'Mid', prop: 'Receiving Yards', recommendation: 'UNDER', pp_line: 20.5, matched_line: 20.5, line_match: 'exact', pp_edge_flex: -3, line_type: 'standard' },
    { player: 'High', prop: 'Receiving Yards', recommendation: 'UNDER', pp_line: 10.5, matched_line: 10.5, line_match: 'exact', pp_edge_flex: -0.4, line_type: 'standard' },
  ]
  for (const sport of ['nfl', 'nhl']) {
    const picked = selectFreeSharpOddsPreview(records, sport)
    assert.deepEqual(picked.map((row) => row.player), ['High', 'Mid', 'Low'], sport)
    assert.equal(picked.some((row) => row.player === 'NoEdge'), false)
  }
  const payload = { records, message: 'matched' }
  for (const ds of ['nfl_sharp_odds', 'nhl_sharp_odds']) {
    const paid = shapeForTier(ds, payload, 'combined')
    assert.deepEqual(paid.data.records.map((row) => row.player), ['NoEdge', 'Low', 'Mid', 'High'], ds)
    const free = shapeForTier(ds, payload, 'free')
    assert.deepEqual(free.data.records.map((row) => row.player), ['High', 'Mid', 'Low'], ds)
    assert.equal(free.lockedCount, 1)
  }
})

test('free sharp odds preview skips a started game with the best edge', () => {
  const records = [
    { player: 'Started', prop: 'Shots On Goal', recommendation: 'OVER', pp_line: 2.5, matched_line: 2.5, line_match: 'exact', pp_edge_flex: 25, start_time: '2000-01-01T00:00:00Z', line_type: 'standard' },
    { player: 'Next', prop: 'Shots On Goal', recommendation: 'OVER', pp_line: 2.5, matched_line: 2.5, line_match: 'exact', pp_edge_flex: 4, line_type: 'standard' },
    { player: 'Mid', prop: 'Shots On Goal', recommendation: 'OVER', pp_line: 1.5, matched_line: 1.5, line_match: 'exact', pp_edge_flex: 2, line_type: 'standard' },
    { player: 'Low', prop: 'Shots On Goal', recommendation: 'UNDER', pp_line: 3.5, matched_line: 3.5, line_match: 'exact', pp_edge_flex: 1, line_type: 'standard' },
  ]
  for (const sport of ['nfl', 'nhl']) {
    const picked = selectFreeSharpOddsPreview(records, sport)
    assert.deepEqual(picked.map((row) => row.player), ['Next', 'Mid', 'Low'], sport)
    assert.equal(picked.some((row) => row.player === 'Started'), false)
  }
  const payload = { records, message: 'matched' }
  for (const ds of ['nfl_sharp_odds', 'nhl_sharp_odds']) {
    const paid = shapeForTier(ds, payload, 'combined')
    assert.deepEqual(paid.data.records.map((row) => row.player), ['Started', 'Next', 'Mid', 'Low'], ds)
    const free = shapeForTier(ds, payload, 'free')
    assert.deepEqual(free.data.records.map((row) => row.player), ['Next', 'Mid', 'Low'], ds)
    assert.equal(free.lockedCount, 1)
  }
})
