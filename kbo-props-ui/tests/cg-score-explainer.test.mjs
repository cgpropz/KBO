import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCgScoreExplainer,
  explainerText,
  nflMiddleCapChanged,
  playerLastName,
  seasonNote,
} from '../src/cgScoreExplainer.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'

const DISCLAIMER = 'Projections are estimates, not guarantees. 21+ · Play responsibly · Entertainment only · 1-800-GAMBLER'

function note(overrides = {}) {
  return buildCgScoreExplainer({
    player: 'Amon-Ra St. Brown',
    projection: 21,
    line: 18.5,
    stat: 'Receiving Yards',
    score: (21 / 18.5) * 50,
    recentValues: [20, 22, 19, 30, 10, 18.5, 25, 16, 21, 14],
    newestFirst: true,
    ...overrides,
  })
}

test('the note uses the approved sentences', () => {
  const text = explainerText(note({
    projectionGames: Array.from({ length: 15 }, () => 2026),
    currentSeason: 2026,
  }))
  assert.equal(text, [
    'CG Score 56.8. Our projection is 21 against a line of 18.5, based on Brown\'s last 15 games.',
    'Recent record: 6 of the last 10 went over this line (1 pushed).',
    DISCLAIMER,
  ].join('\n'))
})

test('a prior-season split uses the approved parenthetical', () => {
  const seasons = [...Array.from({ length: 9 }, () => 2026), ...Array.from({ length: 6 }, () => 2025)]
  const text = explainerText(note({ projectionGames: seasons, currentSeason: 2026 }))
  assert.match(text, /based on Brown's last 15 games \(6 from 2025\)\./)
  assert.equal(seasonNote(seasons, 2026), ' (6 from 2025)')
})

test('an unknown season split leaves the parenthetical out', () => {
  const text = explainerText(note({ projectionGames: [2026, null], currentSeason: 2026 }))
  assert.match(text, /based on Brown's last 2 games\./)
  assert.doesNotMatch(text, /from 202/)
})

test('a missing projection window leaves the based-on clause out', () => {
  const text = explainerText(note())
  assert.equal(text.split('\n')[0], 'CG Score 56.8. Our projection is 21 against a line of 18.5.')
  assert.doesNotMatch(text, /based on/)
  assert.doesNotMatch(text, /last \d+ games/)
})

test('the recent record follows the side the projection points to', () => {
  const recentValues = [22, 10, 19, 12, 21, 9, 20, 11, 18, 8]
  const over = explainerText(note({
    projection: 21,
    line: 18.5,
    score: (21 / 18.5) * 50,
    recentValues,
  }))
  const under = explainerText(note({
    projection: 12,
    line: 18.5,
    score: (12 / 18.5) * 50,
    recentValues,
  }))
  assert.match(over, /Recent record: 4 of the last 10 went over this line\./)
  assert.doesNotMatch(over, /went under/)
  assert.match(under, /Recent record: 6 of the last 10 went under this line\./)
  assert.doesNotMatch(under, /went over/)
})

test('unders count the under side and pushes stay out of the hit count', () => {
  const text = explainerText(note({
    projection: 12,
    line: 18.5,
    score: (12 / 18.5) * 50,
    recentValues: [10, 18.5, 12, 20, 9, 18.5, 11, 30, 8, 7],
  }))
  assert.match(text, /Recent record: 6 of the last 10 went under this line \(2 pushed\)\./)
  assert.doesNotMatch(text, /%/)
})

test('an even projection says no side is favored, and still lists pushes', () => {
  const withPush = explainerText(note({ projection: 18.5, score: 50, recentValues: [10, 20, 18.5] }))
  assert.match(withPush, /Recent record: projection is right on the line, so no side is favored \(1 pushed\)\./)
  assert.doesNotMatch(withPush, /went over|went under/)
  assert.match(withPush, /Small sample, so give this less weight\./)
  assert.match(withPush, /CG Score 50\.0\. Our projection is 18\.5 against a line of 18\.5\./)

  const even = explainerText(note({ projection: 18.5, score: 50, recentValues: [10, 20, 12, 30, 8, 11, 9, 14] }))
  assert.match(even, /Recent record: projection is right on the line, so no side is favored\./)
  assert.doesNotMatch(even, /pushed/)

  const noLog = explainerText(note({ projection: 18.5, score: 50, recentValues: null }))
  assert.match(noLog, /Recent record: projection is right on the line, so no side is favored\./)
  assert.doesNotMatch(noLog, /Small sample|pushed/)
})

test('fewer than 8 graded games adds the small-sample line', () => {
  const text = explainerText(note({ recentValues: [20, 10, 22, 9, 30] }))
  assert.match(text, /Recent record: 3 of the last 5 went over this line\./)
  assert.match(text, /Small sample, so give this less weight\./)
})

test('eight graded games do not add the small-sample line', () => {
  const text = explainerText(note({ recentValues: [20, 10, 22, 9, 30, 8, 19, 11] }))
  assert.doesNotMatch(text, /Small sample/)
})

test('missing recent games leave the record and the small-sample line out', () => {
  const text = explainerText(note({ recentValues: null }))
  assert.doesNotMatch(text, /Recent record/)
  assert.doesNotMatch(text, /Small sample/)
  assert.equal(text.endsWith(DISCLAIMER), true)
})

test('the capped line shows only when the NFL Middle cap changes the score', () => {
  const capped = note({
    projection: 23.7,
    line: 2.5,
    score: nflCgScore(23.7, 2.5, 'Receiving Yards'),
    recentValues: [20, 22, 19, 30, 10, 25, 16, 21, 14, 18],
  })
  assert.equal(nflMiddleCapChanged('Receiving Yards', 23.7, 2.5), true)
  assert.match(explainerText(capped), /Scores on very small lines are adjusted\./)
  assert.match(explainerText(capped), /CG Score 76\.5\./)

  const atFloor = note({ line: 15.5, projection: 20, score: nflCgScore(20, 15.5, 'Receiving Yards') })
  assert.equal(atFloor.capped, false)

  const rush = note({
    stat: 'Rush Yards',
    projection: 9.7,
    line: 1.5,
    score: nflCgScore(9.7, 1.5, 'Rush Yards'),
  })
  assert.equal(rush.capped, true)

  const otherFloor = note({
    stat: 'Pass Yards',
    projection: 200,
    line: 100.5,
    score: nflCgScore(200, 100.5, 'Pass Yards'),
  })
  assert.equal(otherFloor.capped, false)

  const zero = note({ projection: 0, line: 2.5, score: nflCgScore(0, 2.5, 'Receiving Yards') })
  assert.equal(zero.capped, false)
})

test('a name suffix is not the last name', () => {
  assert.equal(playerLastName('Travis Etienne Jr.'), 'Etienne')
  assert.equal(playerLastName('Amon-Ra St. Brown'), 'Brown')
})
