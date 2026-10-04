import assert from 'node:assert/strict'
import test from 'node:test'
import { formatAmerican, nflOddsRows, rowsFromBookPrices, wnbaOddsRows } from '../src/playerOdds.js'

const nflRecords = [
  {
    player: 'Zay Flowers',
    prop: 'Receptions',
    pp_line: 5,
    matched_line: 4.5,
    line_match: 'nearest',
    book_prices: [
      { book: 'DraftKings', book_key: 'draftkings', over: -104, under: null },
      { book: 'PrizePicks', book_key: 'prizepicks', over: -118, under: -118 },
      { book: 'ProphetX', book_key: 'prophetx', over: -103, under: -116 },
    ],
  },
  {
    player: 'Zay Flowers',
    prop: 'Receiving Yards',
    pp_line: 64.5,
    matched_line: 64.5,
    line_match: 'exact',
    book_prices: [
      { book: 'Pinnacle', book_key: 'pinnacle', over: -108, under: -112 },
      { book: 'BetRivers', book_key: 'betrivers', over: -109, under: null },
    ],
  },
  {
    player: 'Zay Flowers',
    prop: 'Rec Targets',
    pp_line: 7.5,
    matched_line: null,
    line_match: 'none',
    book_prices: [],
  },
]

test('nfl odds follow the selected prop and drop pickem books', () => {
  const receptions = nflOddsRows(nflRecords, 'Zay Flowers', 'Receptions', 5)
  assert.deepEqual(receptions.map((row) => row.book), ['DraftKings', 'ProphetX'])
  assert.equal(receptions.find((row) => row.book === 'DraftKings').under, null)
  assert.equal(receptions[0].line, 4.5)

  const yards = nflOddsRows(nflRecords, 'Zay Flowers', 'Receiving Yards', 64.5)
  assert.deepEqual(yards.map((row) => [row.book, row.over, row.under]), [
    ['BetRivers', -109, null],
    ['Pinnacle', -108, -112],
  ])
  assert.equal(yards[0].line, 64.5)
})

test('a prop with no unabated market does not keep the previous prop rows', () => {
  const previous = nflOddsRows(nflRecords, 'Zay Flowers', 'Receptions', 5)
  assert.ok(previous.length)
  assert.deepEqual(nflOddsRows(nflRecords, 'Zay Flowers', 'Rec Targets', 7.5), [])
  assert.deepEqual(nflOddsRows(nflRecords, 'Zay Flowers', 'Rush Yards', 40), [])
})

test('passing touchdown odds follow the Pass TDs prop and leave other props alone', () => {
  const records = [
    ...nflRecords,
    {
      player: 'Joe Burrow',
      prop: 'Pass Yards',
      pp_line: 250.5,
      matched_line: 250.5,
      line_match: 'exact',
      book_prices: [
        { book: 'FanDuel', book_key: 'fanduel', over: -115, under: -105 },
      ],
    },
    {
      player: 'Joe Burrow',
      prop: 'Pass TDs',
      pp_line: 2,
      matched_line: 1.5,
      line_match: 'nearest',
      book_prices: [
        { book: 'DraftKings', book_key: 'draftkings', over: -110, under: -110 },
        { book: 'PrizePicks', book_key: 'prizepicks', over: -119, under: -119 },
        { book: 'Pinnacle', book_key: 'pinnacle', over: -105, under: null },
      ],
    },
  ]
  const touchdowns = nflOddsRows(records, 'Joe Burrow', 'Pass TDs', 2)
  assert.deepEqual(touchdowns.map((row) => [row.book, row.line, row.over, row.under]), [
    ['DraftKings', 1.5, -110, -110],
    ['Pinnacle', 1.5, -105, null],
  ])
  assert.deepEqual(nflOddsRows(records, 'Joe Burrow', 'Pass Yards', 250.5).map((row) => row.book), ['FanDuel'])
  assert.deepEqual(nflOddsRows(records, 'Joe Burrow', 'Receptions', 5), [])
})

test('wnba matched books merge over and under for the exact prop line', () => {
  const records = [
    {
      player: "A'ja Wilson",
      stat_label: 'Points',
      pp_line: 26.5,
      over: { books: [] },
      under: { books: [] },
    },
    {
      player: "A'ja Wilson",
      stat_label: 'Pts+Rebs',
      pp_line: 35.5,
      sharp_reference_line: 35.5,
      over: {
        books: [
          { bookmaker: 'FanDuel', price: -110 },
          { bookmaker: 'PrizePicks', price: -118 },
        ],
      },
      under: {
        books: [
          { bookmaker: 'FanDuel', price: -120 },
          { bookmaker: 'Prophet Exchange', price: -136 },
          { bookmaker: 'Underdog Fantasy', price: -121 },
        ],
      },
    },
  ]

  assert.deepEqual(wnbaOddsRows(records, "A'ja Wilson", 'Points', 26.5), [])
  const combo = wnbaOddsRows(records, "A'ja Wilson", 'Pts+Rebs', 35.5)
  assert.deepEqual(combo.map((row) => [row.book, row.book_key, row.over, row.under, row.line]), [
    ['FanDuel', 'fanduel', -110, -120, 35.5],
    ['Prophet Exchange', 'prophetexchange', null, -136, 35.5],
  ])
  assert.equal(wnbaOddsRows(records, "A'ja Wilson", 'Pts+Rebs', 30.5).length, 0)
})

test('missing book prices and american formatting', () => {
  assert.deepEqual(rowsFromBookPrices(undefined, 5), [])
  assert.equal(formatAmerican(null), '—')
  assert.equal(formatAmerican(103), '+103')
  assert.equal(formatAmerican(-116), '-116')
})
