import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BARS_STUB_NOTE,
  CORR_BANNER,
  CORR_TITLE,
  EMPTY_PAIRS,
  FREE_UPSELL,
  LIMITED_PAIRS,
  LINE_SOURCE_COPY,
  LOOKBACK_CAP,
  MAX_PARTNERS,
  MIN_A_HITS,
  MIN_BARS,
  MIN_SHARED_GAMES,
  NBA_ANCHOR_STATS,
  NBA_CORRELATION_DATASET,
  NBA_CORRELATION_STATIC,
  NBA_MIN_SHARED,
  NBA_PARTNER_STATS,
  OVERS_NOTE,
  PP_NOTE,
  PREVIEW_UPSELL,
  SMALL_SAMPLE_A_HITS_MAX,
  boardAnchor,
  correlatedPanelModel,
  focusBoardProp,
  historicalLine,
  slipLegAnchor,
} from '../src/correlatedProps.js'
import { STANDARD_LINE } from '../src/responsibleGambling.js'

const board = [
  { id: 'a', player: 'A', prop: 'Points', team: 'NY', opponent: 'BOS', side: 'OVER' },
  { id: 'b', player: 'B', prop: 'Rebounds', team: 'NY', opponent: 'BOS', side: 'OVER' },
  { id: 'c', player: 'C', prop: 'Assists', team: 'BOS', opponent: 'NY', side: 'OVER' },
  { id: 'd', player: 'D', prop: 'Points', team: 'NY', opponent: 'MIA', side: 'OVER' },
  { id: 'e', player: 'E', prop: 'Steals', team: 'NY', opponent: 'BOS', side: 'OVER' },
  { id: 'f', player: 'F', prop: 'FG Made', team: 'NY', opponent: 'BOS', side: 'OVER' },
  { id: 'g', player: 'G', prop: '3-PT Made', team: 'NY', opponent: 'BOS', side: 'UNDER' },
  { id: 'h', player: 'H', prop: 'Pts+Rebs+Asts', team: 'NY', opponent: 'vs BOS', side: 'OVER' },
  { id: 'i', player: 'I', prop: 'Assists', team: 'NY', opponent: 'BOS', side: 'OVER' },
  { id: 'self', player: 'A', prop: 'Rebounds', team: 'NY', opponent: 'BOS', side: 'OVER' },
]

const doc = {
  minShared: 15,
  pairs: [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.72, n: 16 },
    { player: 'A', stat: 'Points', partner: 'C', partnerStat: 'Assists', agreement: 0.91, n: 22 },
    { player: 'A', stat: 'Points', partner: 'D', partnerStat: 'Points', agreement: 0.88, n: 30 },
    { player: 'A', stat: 'Points', partner: 'E', partnerStat: 'Steals', agreement: 0.95, n: 40 },
    { player: 'A', stat: 'Points', partner: 'F', partnerStat: 'FG Made', agreement: 0.81, n: 18 },
    { player: 'A', stat: 'Points', partner: 'G', partnerStat: '3-PT Made', agreement: 0.83, n: 19 },
    { player: 'A', stat: 'Points', partner: 'H', partnerStat: 'Pts+Rebs+Asts', agreement: 0.7, n: 40 },
    { player: 'A', stat: 'Points', partner: 'I', partnerStat: 'Assists', agreement: 0.6, n: 21 },
    { player: 'A', stat: 'Points', partner: 'A', partnerStat: 'Rebounds', agreement: 0.99, n: 25 },
    { player: 'B', stat: 'Rebounds', partner: 'C', partnerStat: 'Assists', agreement: 0.31, n: 18 },
  ],
}

function modelFor(anchor, extra = {}, pairs = doc.pairs, rows = board) {
  return correlatedPanelModel({
    anchor,
    board: rows,
    doc: { minShared: 15, pairs },
    entitled: true,
    ...extra,
  })
}

const anchor = boardAnchor(board[0])

test('cleared floors stay centralized and the published sample is not capped at W', () => {
  assert.equal(MIN_SHARED_GAMES, 8)
  assert.equal(MIN_A_HITS, 5)
  assert.equal(SMALL_SAMPLE_A_HITS_MAX, 7)
  assert.equal(MAX_PARTNERS, 5)
  assert.equal(MIN_BARS, 5)
  assert.equal(LOOKBACK_CAP, 20)
  assert.deepEqual(NBA_ANCHOR_STATS, ['Points', 'Rebounds', 'Assists', 'Pts+Rebs+Asts'])
  assert.ok(NBA_PARTNER_STATS.includes('FG Made'))
  assert.ok(NBA_PARTNER_STATS.includes('3-PT Made'))
  assert.equal(NBA_PARTNER_STATS.includes('Steals'), false)
  const wide = modelFor(anchor, {}, [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.8, n: 40 },
  ])
  assert.equal(wide.rows[0].n, 40)
  assert.match(wide.metricNote, /capped at 20/)
  assert.match(wide.metricNote, /not trimmed/)
})

test('often-hit teammates are same-team same-game overs above the existing hit-together bar', () => {
  const result = modelFor(anchor)
  assert.deepEqual(result.rows.map((row) => row.name), ['F', 'B', 'H'])
  assert.equal(result.rows[0].rateLabel, '81%')
  assert.equal(result.rows[0].n, 18)
  assert.equal(result.rows[0].smallSample, false)
  assert.equal(result.showNumbers, true)
  assert.equal(result.title, CORR_TITLE)
  assert.equal(result.historical, 'Historical when A Points hit — not a projection.')
  assert.equal(result.banner, CORR_BANNER)
  assert.equal(result.ppNote, PP_NOTE)
  assert.equal(result.ageLine, STANDARD_LINE)
  assert.match(result.lineSourceNote, /saved_pp_standard/)
  assert.match(result.lineSourceNote, /current_line_retro/)
  assert.equal(result.barsStub, true)
  assert.equal(result.barsNote, BARS_STUB_NOTE)
  assert.equal(result.rows.every((row) => row.bars == null), true)
})

test('exactly 60 percent, other teams, other games, unders, stocks, and same player stay off the list', () => {
  const result = modelFor(anchor)
  const names = result.rows.map((row) => row.name)
  for (const name of ['C', 'D', 'E', 'G', 'I', 'A']) assert.equal(names.includes(name), false)
})

test('a hit count and shared-game floor blank rows, and 5 to 7 A-hits badge', () => {
  const pairs = [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.9, n: 7, nAHits: 12 },
    { player: 'A', stat: 'Points', partner: 'F', partnerStat: 'FG Made', agreement: 0.9, n: 8, aHits: 4 },
    { player: 'A', stat: 'Points', partner: 'H', partnerStat: 'Pts+Rebs+Asts', agreement: 0.77, n: 9, n_a_hits: 5 },
    { player: 'A', stat: 'Points', partner: 'I', partnerStat: 'Assists', agreement: 0.66, n: 12, nAHits: 8 },
  ]
  const result = modelFor(anchor, {}, pairs)
  assert.deepEqual(result.rows.map((row) => row.name), ['H', 'I'])
  assert.equal(result.rows[0].smallSample, true)
  assert.equal(result.rows[1].smallSample, false)
})

test('conditional rate is used when published and is not forced through the 60 percent bar', () => {
  const result = modelFor(anchor, {}, [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.8, conditionalHitRate: 0.55, n: 20 },
  ])
  assert.equal(result.rows[0].rateLabel, '55%')
  assert.match(result.metricNote, /conditional hit rate/)
  assert.equal(result.rows[0].kind, 'conditional')
})

test('line source is labeled from the pair and bars keep oldest-to-newest order', () => {
  const result = modelFor(anchor, {}, [
    {
      player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds',
      agreement: 0.8, n: 20, line_source: 'current_line_retro', l10: 'MHMHM',
    },
    {
      player: 'A', stat: 'Points', partner: 'F', partnerStat: 'FG Made',
      agreement: 0.7, n: 20, lineSource: 'saved_pp_standard', conditionalBars: ['H', 'H', 'M', 'H'],
    },
  ])
  assert.equal(result.lineSourceNote, LINE_SOURCE_COPY.mixed)
  assert.deepEqual(result.rows[0].bars, ['miss', 'hit', 'miss', 'hit', 'miss'])
  assert.equal(result.rows[1].barsMode, 'short')
  assert.equal(result.barsStub, false)
})

test('a long bar string keeps the latest 10 without reversing', () => {
  const result = modelFor(anchor, {}, [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.8, n: 20, l10: `H${'M'.repeat(10)}` },
  ])
  assert.equal(result.rows[0].bars.length, 10)
  assert.equal(result.rows[0].bars[0], 'miss')
  assert.equal(result.rows[0].bars.includes('hit'), false)
})

test('unknown bar tokens stay a stub instead of a guessed color', () => {
  const result = modelFor(anchor, {}, [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.8, n: 20, l10: 'HHHHX' },
  ])
  assert.equal(result.rows[0].barsMode, 'stub')
  assert.equal(result.barsStub, true)
})

test('stocks and other anchors do not list pairs', () => {
  const result = modelFor(boardAnchor({ player: 'E', prop: 'Steals', team: 'NY', opponent: 'BOS', side: 'OVER' }))
  assert.equal(result.status, 'limited')
  assert.equal(result.showNumbers, false)
  assert.equal(result.message, LIMITED_PAIRS)
  assert.deepEqual(result.rows, [])
})

test('an under anchor still lists overs and says so', () => {
  const result = modelFor(boardAnchor({ ...board[0], side: 'UNDER' }))
  assert.equal(result.oversNote, OVERS_NOTE)
  assert.equal(result.rows.some((row) => row.name === 'B'), true)
})

test('the list caps at five teammates', () => {
  const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
  const rows = [
    board[0],
    ...names.map((name) => ({ id: name, player: name, prop: 'Rebounds', team: 'NY', opponent: 'BOS', side: 'OVER' })),
  ]
  const pairs = names.map((name, index) => ({
    player: 'A', stat: 'Points', partner: name, partnerStat: 'Rebounds', agreement: 0.95 - index * 0.01, n: 20,
  }))
  const result = modelFor(anchor, {}, pairs, rows)
  assert.equal(result.rows.length, 5)
  assert.deepEqual(result.rows.map((row) => row.name), ['P1', 'P2', 'P3', 'P4', 'P5'])
})

test('a standard line wins over a promo line for the same prop', () => {
  const rows = [
    board[0],
    { id: 'b-demon', player: 'B', prop: 'Rebounds', team: 'NY', opponent: 'BOS', side: 'OVER', oddsType: 'demon' },
    { id: 'b-std', player: 'B', prop: 'Rebounds', team: 'NY', opponent: 'BOS', side: 'OVER' },
  ]
  const result = modelFor(anchor, {}, [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.8, n: 20 },
  ], rows)
  assert.equal(result.rows[0].id, 'b-std')
})

test('free and preview models keep the caveats and drop paid numbers', () => {
  const paid = modelFor(anchor)
  const free = modelFor(anchor, { entitled: false })
  const preview = modelFor(anchor, { entitled: false, memberPreview: true })
  assert.equal(free.status, 'locked')
  assert.equal(free.showNumbers, false)
  assert.equal(free.showPlans, true)
  assert.equal(free.message, FREE_UPSELL)
  assert.deepEqual(free.rows, [])
  assert.equal(free.historical, historicalLine(anchor))
  assert.equal(free.ppNote, PP_NOTE)
  assert.match(free.ageLine, /21\+/)
  assert.match(free.ageLine, /Play responsibly/)
  const dumped = JSON.stringify(free)
  assert.equal(dumped.includes('72%'), false)
  assert.equal(dumped.includes('81%'), false)
  assert.equal(dumped.includes('"n":'), false)
  assert.equal(preview.message, PREVIEW_UPSELL)
  assert.equal(preview.showPlans, false)
  assert.equal(paid.rows.length > 0, true)
})

test('a slip leg can anchor the same list', () => {
  const leg = slipLegAnchor({ idx: 3, name: 'A', prop: 'Points', team: 'NY', opponent: 'BOS', side: 'OVER' })
  assert.equal(leg.id, 'slip-3')
  const result = modelFor(leg)
  assert.equal(result.rows.some((row) => row.name === 'B'), true)
})

test('focus widens the prop tab and side filter enough to show the row', () => {
  assert.deepEqual(focusBoardProp(board[1], { propTab: 'Points', side: 'Unders' }), { propTab: 'All Props', side: 'All' })
  assert.deepEqual(focusBoardProp(board[0], { propTab: 'Points', side: 'Overs' }), {})
})

test('an empty entitled file and a missing file do not invent pairs', () => {
  const empty = correlatedPanelModel({ anchor, board, doc: { pairs: [] }, entitled: true })
  assert.equal(empty.status, 'empty')
  assert.equal(empty.message, EMPTY_PAIRS)
  assert.equal(empty.showNumbers, false)
  const hidden = correlatedPanelModel({ anchor, board, doc: { unavailable: true, pairs: [] }, entitled: true })
  assert.equal(hidden.status, 'unavailable')
  assert.deepEqual(hidden.rows, [])
})

test('the loader and the board mount reuse the published NBA pair file', () => {
  const sports = readFileSync(new URL('../src/slipSports.js', import.meta.url), 'utf8')
  assert.match(sports, new RegExp(`dataset: '${NBA_CORRELATION_DATASET}'`))
  assert.match(sports, new RegExp(`staticPath: '${NBA_CORRELATION_STATIC}'`))
  assert.match(sports, new RegExp(`minShared: ${NBA_MIN_SHARED}`))
  const loader = readFileSync(new URL('../src/loadNbaCorrelations.js', import.meta.url), 'utf8')
  assert.match(loader, /fetchApiDataset/)
  assert.match(loader, /presentCorrelationDoc/)
  assert.equal(loader.includes('correlations.py'), false)
  const panel = readFileSync(new URL('../src/CorrelatedPropsPanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /data-testid="nba-correlated-panel"/)
  assert.match(panel, /data-testid="nba-corr-draft"/)
  assert.match(panel, /data-testid="nba-corr-pp"/)
  assert.match(panel, /data-testid="nba-corr-age"/)
  assert.match(panel, /model\.banner/)
  assert.match(panel, /model\.historical/)
  const boardSource = readFileSync(new URL('../src/nba/NbaDashboard.jsx', import.meta.url), 'utf8')
  assert.match(boardSource, /CorrelatedPropsPanel/)
  assert.match(boardSource, /loadNbaCorrelations/)
  assert.match(boardSource, /correlatedPanelModel/)
  assert.equal(boardSource.includes('preview && !refreshing'), false)
  const logic = readFileSync(new URL('../src/correlatedProps.js', import.meta.url), 'utf8')
  assert.match(logic, /correlated_props_rule_2026-10-25\.md/)
  assert.equal(logic.includes('pipeline/correlations.py'), false)
})
