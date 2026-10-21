import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeCgOdds } from '../src/nfl/cgOdds.js'
import {
  booksCount,
  consensusBookPrices,
  displayedBookCount,
  isExcludedBook,
  policyBestQuote,
} from '../src/nfl/bookPolicy.js'

test('excluded names match case and spacing, and Polymarket stays', () => {
  for (const name of [
    'DraftKings Pick6', 'DRAFTKINGS PICK6', 'DraftKings  Pick 6', 'draftkings-pick6',
    'Kalshi', 'Polymarket US', 'Polymarket U.S.', 'Novig', 'Prophet Exchange',
    'ProphetExchange', 'Underdog Prediction Market', 'Fliff',
  ]) {
    assert.equal(isExcludedBook(name), true, name)
  }
  assert.equal(isExcludedBook('DraftKings'), false)
  assert.equal(isExcludedBook('Polymarket'), false)
  assert.equal(isExcludedBook({ book: 'House Special', source_id: 84 }), true)
  assert.equal(isExcludedBook({ book: 'Polymarket', source_id: 107 }), false)
})

test('shared feed counts once and consensus keeps BetOnline', () => {
  const quotes = [
    { book: 'FanDuel', book_key: 'fanduel', over: -110, under: -110 },
    { book: 'BetOnline', book_key: 'betonline', over: -130, under: 110 },
    { book: 'SportsBetting', book_key: 'sportsbetting', over: -110, under: -110 },
    { book: 'Bovada', book_key: 'bovada', over: 100, under: -120 },
    { book: 'Kalshi', book_key: 'kalshi', over: 200, under: -250 },
  ]
  assert.equal(booksCount(quotes), 2)
  const consensus = consensusBookPrices(quotes)
  assert.deepEqual(consensus.map((quote) => quote.book).sort(), ['BetOnline', 'FanDuel'])
  const betonline = consensus.find((quote) => quote.book === 'BetOnline')
  assert.equal(betonline.over, -130)
  assert.equal(betonline.under, 110)
  assert.equal(policyBestQuote({ book: 'Kalshi', book_key: 'kalshi', price: 200 }, quotes, 'over').book, 'Bovada')
  assert.equal(policyBestQuote({ book: 'Bovada', book_key: 'bovada', price: 100 }, quotes, 'over').book, 'Bovada')
})

test('one-sided shared skins do not become a second consensus book', () => {
  const quotes = [
    { book: 'Pinnacle', book_key: 'pinnacle', over: -110, under: -110 },
    { book: 'BetOnline', book_key: 'betonline', over: -105, under: null },
    { book: 'Bovada', book_key: 'bovada', over: null, under: -115 },
  ]
  const consensus = consensusBookPrices(quotes)
  const shared = consensus.find((quote) => quote.book === 'BetOnline' || quote.book === 'Bovada')
  assert.equal(shared.book, 'BetOnline')
  assert.equal(shared.over, -105)
  assert.equal(shared.under, null)
  const item = {
    prop: 'Receptions',
    pp_line: 4.5,
    matched_line: 4.5,
    book_prices: quotes,
  }
  assert.deepEqual(computeCgOdds(item, 'over', 119 / 219).books, ['Pinnacle'])
})

test('consensus is unchanged when no excluded or duplicate books are present', () => {
  const base = {
    prop: 'Receptions',
    pp_line: 4.5,
    matched_line: 4.5,
    book_prices: [
      { book: 'Pinnacle', book_key: 'pinnacle', over: -130, under: 105 },
      { book: 'DraftKings', book_key: 'draftkings', over: -145, under: 115 },
    ],
  }
  const alone = computeCgOdds(base, 'over', 119 / 219)
  const again = computeCgOdds(base, 'over', 119 / 219)
  assert.equal(again.probability, alone.probability)
  assert.equal(again.american, alone.american)
  assert.deepEqual(again.books, ['Pinnacle', 'DraftKings'])
  assert.equal(displayedBookCount({ fair_books: ['Pinnacle', 'DraftKings'], fair_book_count: 2 }), 2)
  assert.equal(booksCount(base.book_prices), 2)
})

test('excluded books and the extra shared-feed skins do not move CG odds', () => {
  const base = {
    prop: 'Receptions',
    pp_line: 4.5,
    matched_line: 4.5,
    book_prices: [
      { book: 'Pinnacle', book_key: 'pinnacle', over: -130, under: 105 },
      { book: 'DraftKings', book_key: 'draftkings', over: -145, under: 115 },
      { book: 'BetOnline', book_key: 'betonline', over: -110, under: -110 },
    ],
  }
  const noisy = {
    ...base,
    book_prices: [
      ...base.book_prices,
      { book: 'Kalshi', book_key: 'kalshi', over: 200, under: -250 },
      { book: 'DRAFTKINGS PICK6', book_key: 'draftkingspick6', over: 300, under: -400 },
      { book: 'SportsBetting', book_key: 'sportsbetting', over: 150, under: -180 },
      { book: 'Bovada', book_key: 'bovada', over: 140, under: -170 },
      { book: 'Polymarket US', book_key: 'polymarketus', over: 160, under: -190 },
    ],
  }
  const clean = computeCgOdds(base, 'over', 119 / 219)
  const dirty = computeCgOdds(noisy, 'over', 119 / 219)
  assert.equal(dirty.probability, clean.probability)
  assert.equal(dirty.books.length, clean.books.length)
  assert.ok(dirty.books.includes('BetOnline'))
  assert.equal(dirty.books.some((name) => /kalshi|bovada|sportsbetting|pick6|polymarket us/i.test(name)), false)
  const unfiltered = computeCgOdds(noisy, 'over', 119 / 219, { applyBookPolicy: false })
  assert.notEqual(unfiltered.probability, dirty.probability)
})

test('the strip drops excluded books and still shows the shared feed', () => {
  const prices = [
    { book: 'Kalshi', book_key: 'kalshi', over: 200, under: -250 },
    { book: 'BetOnline', book_key: 'betonline', over: -130, under: 110 },
    { book: 'Bovada', book_key: 'bovada', over: 100, under: -120 },
    { book: 'FanDuel', book_key: 'fanduel', over: -110, under: -110 },
  ]
  const books = prices.filter((book) => book && !isExcludedBook(book))
  assert.deepEqual(books.map((book) => book.book).sort(), ['BetOnline', 'Bovada', 'FanDuel'])
  assert.equal(displayedBookCount({ fair_books: ['FanDuel', 'BetOnline', 'SportsBetting', 'Bovada', 'Kalshi'] }), 2)
  const strip = readFileSync(new URL('../src/nfl/BookOddsStrip.jsx', import.meta.url), 'utf8')
  assert.match(strip, /isExcludedBook/)
  const nfl = readFileSync(new URL('../src/nfl/NflSharpOdds.jsx', import.meta.url), 'utf8')
  const nhl = readFileSync(new URL('../src/nhl/NhlSharpOdds.jsx', import.meta.url), 'utf8')
  const nba = readFileSync(new URL('../src/nba/NbaSharpOdds.jsx', import.meta.url), 'utf8')
  assert.match(nfl, /policyBestQuote\(item\.best_over/)
  assert.match(nhl, /displayedBookCount\(item\)/)
  assert.match(nba, /displayedBookCount\(item\)/)
  assert.match(nba, /policyBestQuote\(item\.best_over/)
})
