import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicBoardStatus } from '../api/_boardStatus.js'
import {
  STALE_AFTER_HOURS,
  boardStatusLine,
  buildBoardStatus,
  cheatsheetWarningLine,
  formatBoardClock,
  injuryCheckedAtFromPayload,
  isBoardStale,
  isoWithEtOffset,
  propCountFor,
} from '../src/boardFreshness.js'

const NOW = new Date('2026-10-11T15:00:00Z')
const PUBLISHED = '2026-10-11T13:44:00Z'

test('clock is America/New_York with an ET label', () => {
  assert.equal(formatBoardClock(PUBLISHED), '9:44 AM ET')
  assert.equal(formatBoardClock(''), '')
  assert.equal(isoWithEtOffset(PUBLISHED), '2026-10-11T09:44:00-04:00')
})

test('stale windows match the per-sport hours', () => {
  assert.equal(STALE_AFTER_HOURS.kbo, 18)
  assert.equal(STALE_AFTER_HOURS.wnba, 12)
  assert.equal(STALE_AFTER_HOURS.nfl, 18)
  assert.equal(STALE_AFTER_HOURS.nba, 12)
  assert.equal(STALE_AFTER_HOURS.nhl, 12)
  assert.equal(isBoardStale(PUBLISHED, 'kbo', NOW), false)
  assert.equal(isBoardStale('2026-10-11T02:00:00Z', 'wnba', NOW), true)
  assert.equal(isBoardStale('2026-10-11T02:00:00Z', 'nfl', NOW), false)
  assert.equal(isBoardStale(null, 'nba', NOW), true)
})

test('status line uses the publish clock and a stale note', () => {
  assert.equal(boardStatusLine({ updatedAt: PUBLISHED, sport: 'kbo', now: NOW }), 'Board updated 9:44 AM ET')
  const yesterday = boardStatusLine({
    updatedAt: '2026-10-10T13:44:00Z',
    sport: 'nhl',
    now: NOW,
  })
  assert.equal(yesterday, 'Board updated Oct 10, 9:44 AM ET · stale')
  assert.equal(boardStatusLine({ updatedAt: 'not-a-time', sport: 'nfl', now: NOW }), '')
})

test('injury line appears only for a recorded check time', () => {
  assert.equal(injuryCheckedAtFromPayload({ scraped_at: PUBLISHED, generated_at: PUBLISHED }), null)
  assert.equal(injuryCheckedAtFromPayload([{ injury: 'OUT' }]), null)
  const line = boardStatusLine({
    updatedAt: PUBLISHED,
    sport: 'nfl',
    injuriesCheckedAt: '2026-10-11T14:05:00Z',
    now: NOW,
  })
  assert.equal(line, 'Board updated 9:44 AM ET · injuries checked 10:05 AM ET')
})

test('status document is one entry per board and has no prop rows', () => {
  const document = buildBoardStatus({
    now: NOW,
    previous: [{
      sport: 'nfl',
      board_updated_at: '2026-10-11T08:00:00-04:00',
      injuries_checked_at: null,
      prop_count: 40,
      stale: false,
    }],
    snapshots: {
      kbo: {
        publishedAt: PUBLISHED,
        data: { cards: [{ name: 'Secret Batter', props: [{}, {}] }] },
      },
      wnba: {
        data: [{ name: 'Secret Guard', ppAllProps: [{}] }],
      },
    },
  })
  assert.deepEqual(Object.keys(document), ['boards'])
  assert.deepEqual(document.boards.map((board) => board.sport), ['kbo', 'wnba', 'nfl', 'nba', 'nhl'])
  for (const board of document.boards) {
    assert.deepEqual(Object.keys(board), ['sport', 'board_updated_at', 'injuries_checked_at', 'prop_count', 'stale'])
  }
  const encoded = JSON.stringify(document)
  assert.equal(encoded.includes('Secret'), false)
  assert.equal(encoded.includes('props'), false)
  const kbo = document.boards[0]
  assert.equal(kbo.board_updated_at, '2026-10-11T09:44:00-04:00')
  assert.equal(kbo.injuries_checked_at, null)
  assert.equal(kbo.prop_count, 2)
  assert.equal(kbo.stale, false)
  assert.equal(document.boards[1].prop_count, 1)
  assert.equal(document.boards[1].board_updated_at, null)
  assert.equal(document.boards[1].stale, true)
  assert.equal(document.boards[2].prop_count, 40)
  assert.equal(document.boards[2].stale, false)
  assert.equal(propCountFor('nhl', [{}, {}, {}]), 3)
})

test('nhl status keeps removed reason counts and other sports do not', () => {
  const reasons = {
    pp_pull: 2,
    superseded_dup: 1,
    manual_out: 0,
    news_out: 0,
    lineup_out: 0,
  }
  const document = buildBoardStatus({
    now: NOW,
    previous: [{
      sport: 'nhl',
      board_updated_at: '2026-10-11T08:00:00-04:00',
      prop_count: 4,
      removed_reasons: reasons,
    }],
    snapshots: {
      nfl: { publishedAt: PUBLISHED, data: [{ player: 'Secret Back' }] },
    },
  })
  const nhl = document.boards.find((board) => board.sport === 'nhl')
  const nfl = document.boards.find((board) => board.sport === 'nfl')
  assert.deepEqual(nhl.removed_reasons, reasons)
  assert.equal(Object.hasOwn(nfl, 'removed_reasons'), false)
  const rebuilt = buildBoardStatus({
    now: NOW,
    snapshots: {
      nhl: {
        publishedAt: PUBLISHED,
        data: [
          { player: 'Live' },
          { player: 'Old', removed: true, removed_reason: 'superseded_dup' },
          { player: 'Pulled', removed: true, removed_reason: 'pp_pull' },
        ],
      },
    },
  })
  assert.equal(rebuilt.boards.find((board) => board.sport === 'nhl').removed_reasons.pp_pull, 1)
  assert.equal(rebuilt.boards.find((board) => board.sport === 'nhl').prop_count, 3)
  const served = publicBoardStatus({
    boards: [{
      sport: 'nhl',
      board_updated_at: PUBLISHED,
      injuries_checked_at: null,
      prop_count: 3,
      stale: false,
      removed_reasons: reasons,
      props: [{ player: 'Secret' }],
    }],
  })
  const servedNhl = served.boards.find((board) => board.sport === 'nhl')
  assert.deepEqual(servedNhl.removed_reasons, reasons)
  assert.equal(Object.hasOwn(servedNhl, 'props'), false)
  assert.equal(JSON.stringify(served).includes('Secret'), false)
})

test('cheat sheet warning names the largest gap over 60 minutes', () => {
  const payload = {
    warnings: [
      { sport: 'wnba', minutes_older: 75, message: 'old' },
      { sport: 'wnba', minutes_older: 140, message: 'older' },
      { sport: 'kbo', minutes_older: 200, message: 'other sport' },
      { sport: 'nhl', minutes_older: 40, message: 'still fresh enough' },
    ],
  }
  assert.equal(cheatsheetWarningLine(payload, 'wnba'), 'Cheat sheet is 140 min older than this board')
  assert.equal(cheatsheetWarningLine(payload, 'nhl'), '')
  assert.equal(cheatsheetWarningLine(null, 'kbo'), '')
})
