import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NO_BOOK_ODDS_MESSAGE,
  boardSide,
  indexSharpOdds,
  lookupSharpOdds,
  oddsPanelMessage,
  wnbaRecordsAsSharp,
} from '../src/boardOdds.js'

const records = [
  {
    player: 'Kirk Cousins',
    prop: 'Pass TDs',
    pp_line: 1.5,
    line_match: 'exact',
    recommendation: 'OVER',
    book_prices: [
      { book: 'FanDuel', book_key: 'fanduel', over: 114, under: -140 },
      { book: 'DraftKings', book_key: 'draftkings', over: 114, under: -138 },
    ],
  },
  {
    player: 'Kirk Cousins',
    prop: 'Pass Yards',
    pp_line: 245.5,
    line_match: 'nearest',
    matched_line: 246.5,
    book_prices: [{ book: 'BetMGM', book_key: 'betmgm', over: -110, under: -110 }],
  },
  {
    player: 'Kirk Cousins',
    prop: 'Rec Targets',
    pp_line: 0.5,
    line_match: 'none',
    unmatched_reason: 'market_not_in_feed',
    book_prices: [],
  },
  {
    player: 'A.J. Brown',
    prop: 'Receptions',
    pp_line: 4.5,
    line_match: 'exact',
    book_prices: [],
  },
]

test('board odds match the same player, stat, and line', () => {
  const index = indexSharpOdds(records)
  const passTds = lookupSharpOdds(index, { player: 'Kirk Cousins', prop: 'Pass TDs', line: 1.5 })
  assert.equal(passTds.book_prices[0].book, 'FanDuel')
  assert.equal(lookupSharpOdds(index, { player: 'kirk cousins', prop: 'pass tds', line: '1.5' }).prop, 'Pass TDs')
  assert.equal(lookupSharpOdds(index, { player: 'Kirk Cousins', prop: 'Pass TDs', line: 2.5 }), null)
  assert.equal(lookupSharpOdds(index, { player: 'Kirk Cousins', prop: 'Pass Attempts', line: 1.5 }), null)
  assert.equal(lookupSharpOdds(index, { player: 'Justin Herbert', prop: 'Pass TDs', line: 1.5 }), null)
})

test('nearest book line still belongs to that PrizePicks prop', () => {
  const index = indexSharpOdds(records)
  const yards = lookupSharpOdds(index, { player: 'Kirk Cousins', prop: 'Pass Yards', line: 245.5 })
  assert.equal(yards.line_match, 'nearest')
  assert.equal(yards.matched_line, 246.5)
})

test('a prop with no sportsbook price is not a match', () => {
  const index = indexSharpOdds(records)
  assert.equal(lookupSharpOdds(index, { player: 'Kirk Cousins', prop: 'Rec Targets', line: 0.5 }), null)
  assert.equal(lookupSharpOdds(index, { player: 'A.J. Brown', prop: 'Receptions', line: 4.5 }), null)
})

test('the board side follows the projection against the line', () => {
  assert.equal(boardSide(1.8, 1.5), 'over')
  assert.equal(boardSide(1.5, 1.5), 'over')
  assert.equal(boardSide(1.2, 1.5), 'under')
  assert.equal(boardSide(null, 1.5), null)
})

test('missing odds use the empty-line message only when the snapshot is complete', () => {
  assert.equal(oddsPanelMessage({ book_prices: [{}] }, 'ready'), null)
  assert.equal(oddsPanelMessage(null, 'ready'), NO_BOOK_ODDS_MESSAGE)
  assert.equal(oddsPanelMessage(null, 'loading'), 'Loading sportsbook odds.')
  assert.equal(oddsPanelMessage(null, 'error'), 'Sportsbook odds are unavailable right now.')
  assert.equal(oddsPanelMessage(null, 'preview'), 'Sportsbook odds for this line are not in the free preview.')
  assert.equal(oddsPanelMessage(null, 'preview', true), NO_BOOK_ODDS_MESSAGE)
})

test('wnba book lists become the same book_prices shape', () => {
  const [matched, empty] = wnbaRecordsAsSharp([
    {
      player: 'A’ja Wilson',
      stat_label: 'Points',
      pp_line: 24.5,
      over: { books: [{ bookmaker: 'FanDuel', price: -115 }, { bookmaker: 'PrizePicks', price: -119 }] },
      under: { books: [{ bookmaker: 'FanDuel', price: -105 }] },
    },
    {
      player: 'A’ja Wilson',
      stat_label: 'Rebounds',
      pp_line: 10.5,
      over: { books: [] },
      under: { books: [] },
    },
  ])
  assert.equal(matched.prop, 'Points')
  assert.equal(matched.line_match, 'exact')
  assert.deepEqual(matched.book_prices.map((book) => book.book), ['FanDuel'])
  assert.equal(matched.book_prices[0].over, -115)
  assert.equal(matched.book_prices[0].under, -105)
  assert.equal(empty.line_match, 'none')
  const index = indexSharpOdds([matched, empty])
  assert.equal(lookupSharpOdds(index, { player: "A'ja Wilson", prop: 'Points', line: 24.5 }).book_prices[0].book, 'FanDuel')
  assert.ok(lookupSharpOdds(index, { player: 'A’ja Wilson', prop: 'points', line: 24.5 }))
  assert.equal(lookupSharpOdds(index, { player: 'A’ja Wilson', prop: 'Rebounds', line: 10.5 }), null)
})
