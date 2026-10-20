import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prizepicksPulled } from '../src/nhl/pointsGate.js'
import { boardCanConfirm, boardOnHold, liveLineLookup, mergeLivePrizePicks, withoutLiveLine } from '../src/kboLiveLines.js'

const src = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const pulled = { removed: true, pp_status: 'removed', pulled_reason: 'prizepicks_no_kbo_lines' }

// Snapshot rows as batter_projections / strikeout_projections carry them on 10/19 8:12 PM ET.
const snapshot = [
  { name: 'Dong Won Park', prop: 'Total Bases', line: 0.5, projection: 0.97, rating: 96.6, ...pulled },
  { name: 'Oller', prop: 'Strikeouts', line: 5.5, projection: 6.1, rating: 70, ...pulled },
  { name: 'Harold Castro', prop: 'Fantasy Score', line: 6, projection: 8.87, rating: 73.9 },
]

test('projection pages drop pulled rows before the snapshot fallback merge', () => {
  assert.deepEqual(snapshot.filter((p) => !prizepicksPulled(p)).map((p) => p.name), ['Harold Castro'])
  const batter = src('BatterProjections.jsx')
  assert.match(batter, /import \{ prizepicksPulled \} from '\.\/nhl\/pointsGate'/)
  assert.match(batter, /const mergedProjections = \(data\?\.projections \|\| \[\]\)\.filter\(\(p\) => !prizepicksPulled\(p\)\)\.map\(/)
  const ks = src('StrikeoutProjections.jsx')
  assert.match(ks, /import \{ prizepicksPulled \} from '\.\/nhl\/pointsGate'/)
  assert.match(ks, /const mergedScoped = scoped\.filter\(\(p\) => !prizepicksPulled\(p\)\)\.map\(/)
})

// 10/20 LG @ Kia. Kim's FS 6.5 is pulled; Castro FS 6 is live; Oller K 5.5 is live,
// Shirakawa has no K line.
const game = () => ({
  away: 'LG', home: 'Kia',
  away_pitcher: { name: 'Shirakawa', line: 5.5, k_projection: 5.9 },
  home_pitcher: { name: 'Oller', line: 5.5, k_projection: 6.1 },
  props: [
    { name: 'Kim Do-yeong', team: 'Kia', prop: 'Fantasy Score', line: 6.5, projection: 8.96, edge: 2.46, recommendation: 'OVER' },
    { name: 'Harold Castro', team: 'Kia', prop: 'Fantasy Score', line: 6, projection: 8.87, edge: 2.87, recommendation: 'OVER' },
    { name: 'Oller', team: 'Kia', prop: 'Strikeouts', line: 5.5, projection: 6.1, edge: 0.6, recommendation: 'OVER' },
    { name: 'Shirakawa', team: 'LG', prop: 'Strikeouts', line: 5.5, projection: 5.9, edge: 0.4, recommendation: 'OVER' },
  ],
})
const board = (extra = {}) => ({
  cards: [
    { name: 'Harold Castro', team: 'Kia', opponent: 'LG', props: [{ stat: 'Hitter Fantasy Score', line: 6, odds_type: 'standard' }] },
    { name: 'Kim Do-yeong', team: 'Kia', opponent: 'LG', props: [{ stat: 'Hitter Fantasy Score', line: 6.5, odds_type: 'standard', ...pulled }] },
    { name: 'Oller', team: 'Kia', opponent: 'LG', props: [{ stat: 'Pitcher Strikeouts', line: 5.5, odds_type: 'standard' }] },
  ],
  ...extra,
})
const byName = (out) => Object.fromEntries(out.matchups[0].props.map((p) => [p.name, p]))
const cleared = (p) => p.line === null && p.edge === null && p.recommendation === 'NO LINE'

test('matchup page: exact name match only, no team/opponent fallback', () => {
  const out = mergeLivePrizePicks({ matchups: [game()] }, board())
  const rows = byName(out)
  // Kim's pulled FS 6.5 must not pick up Castro's FS 6.
  assert.equal(cleared(rows['Kim Do-yeong']), true)
  assert.equal(rows['Kim Do-yeong'].projection, 8.96)
  assert.deepEqual([rows['Harold Castro'].line, rows['Harold Castro'].recommendation], [6, 'OVER'])
  assert.deepEqual([rows.Oller.line, rows.Oller.recommendation], [5.5, 'OVER'])
  // Shirakawa must not get Oller's K 5.5 (different team, no fallback anyway).
  assert.equal(cleared(rows.Shirakawa), true)
  assert.equal(out.matchups[0].away_pitcher.line, null)
  assert.equal(out.matchups[0].home_pitcher.line, 5.5)
  // A name-signature match (word order) still works.
  const swapped = board()
  swapped.cards[0].name = 'Castro Harold'
  assert.equal(byName(mergeLivePrizePicks({ matchups: [game()] }, swapped))['Harold Castro'].line, 6)
  // Without a name, nothing matches.
  assert.equal(liveLineLookup(board().cards)({ statNames: ['Hitter Fantasy Score'], team: 'Kia', opponent: 'LG', name: '' }), null)
})

test('matchup page fails closed: board fetch failed, empty board, or the #305 hold', () => {
  for (const pp of [{ cards: [], failed: true }, null, { cards: [] }, board({ kbo_hold: { active: true, message: 'Lines not posted yet' } })]) {
    const out = mergeLivePrizePicks({ matchups: [game()] }, pp)
    assert.equal(out.matchups[0].props.every(cleared), true)
    assert.equal(out.matchups[0].away_pitcher.line, null)
    assert.equal(out.matchups[0].home_pitcher.line, null)
    // Projections stay.
    assert.equal(out.matchups[0].home_pitcher.k_projection, 6.1)
    assert.deepEqual(out.matchups[0].props.map((p) => p.projection), [8.96, 8.87, 6.1, 5.9])
  }
  assert.equal(boardOnHold({ kbo_hold: { active: false } }), false)
  assert.equal(boardCanConfirm({ cards: [], failed: true }), false)
  const oller = { name: 'Oller', line: 5.5, edge: 0.6, recommendation: 'OVER' }
  assert.deepEqual(withoutLiveLine(oller), { ...oller, line: null, edge: null, recommendation: 'NO LINE' })
  const s = src('MatchupDeepDive.jsx')
  assert.match(s, /mergeLivePrizePicks\(withMarkets, ppSnap\?\.data \|\| \{ cards: \[\], failed: true \}\)/)
  assert.doesNotMatch(src('kboLiveLines.js'), /teamOpp/)
})

test('matchup page: standard PrizePicks line only, never a goblin or demon line', () => {
  const promoBoard = {
    cards: [
      // Median of 4.5/5.5/6.5 across odds types was 5.5 before; the standard line is 6.5.
      { name: 'Oller', team: 'Kia', opponent: 'LG', props: [
        { stat: 'Pitcher Strikeouts', line: 4.5, odds_type: 'goblin' },
        { stat: 'Pitcher Strikeouts', line: 6.5, odds_type: 'standard' },
        { stat: 'Pitcher Strikeouts', line: 5.5, odds_type: 'demon' },
      ] },
      // Castro only has promo lines: NO LINE.
      { name: 'Harold Castro', team: 'Kia', opponent: 'LG', props: [
        { stat: 'Hitter Fantasy Score', line: 4.5, odds_type: 'goblin' },
        { stat: 'Hitter Fantasy Score', line: 9.5, odds_type: 'Demon' },
      ] },
    ],
  }
  const getLine = liveLineLookup(promoBoard.cards)
  assert.equal(getLine({ statNames: ['Pitcher Strikeouts'], team: 'Kia', opponent: 'LG', name: 'Oller' }), 6.5)
  assert.equal(getLine({ statNames: ['Hitter Fantasy Score'], team: 'Kia', opponent: 'LG', name: 'Harold Castro' }), null)
  const out = mergeLivePrizePicks({ matchups: [game()] }, promoBoard)
  const rows = byName(out)
  assert.equal(rows.Oller.line, 6.5)
  assert.equal(out.matchups[0].home_pitcher.line, 6.5)
  assert.equal(cleared(rows['Harold Castro']), true)
  // A blank or unknown odds type is not standard either.
  const odd = liveLineLookup([{ name: 'Oller', team: 'Kia', opponent: 'LG', props: [
    { stat: 'Pitcher Strikeouts', line: 3.5, odds_type: '' },
    { stat: 'Pitcher Strikeouts', line: 7.5, odds_type: 'flex' },
  ] }])
  assert.equal(odd({ statNames: ['Pitcher Strikeouts'], team: 'Kia', opponent: 'LG', name: 'Oller' }), null)
})
