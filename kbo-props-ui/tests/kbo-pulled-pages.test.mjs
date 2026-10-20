import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prizepicksPulled } from '../src/nhl/pointsGate.js'
import { boardCanConfirm, withoutLiveLine } from '../src/kboLiveLines.js'

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

test('matchup page: no live line means no line, edge or pick', () => {
  const oller = { name: 'Oller', prop: 'Strikeouts', line: 5.5, projection: 6.1, edge: 0.6, recommendation: 'OVER' }
  assert.deepEqual(withoutLiveLine(oller), { ...oller, line: null, edge: null, recommendation: 'NO LINE' })
  // A loaded board, even an empty one, confirms lines; a failed fetch does not.
  assert.equal(boardCanConfirm({ cards: [] }), true)
  assert.equal(boardCanConfirm({ cards: [], prizepicks_pull: { status: 'confirmed_empty' } }), true)
  assert.equal(boardCanConfirm({ cards: [], failed: true }), false)
  assert.equal(boardCanConfirm(null), false)

  const s = src('MatchupDeepDive.jsx')
  assert.match(s, /if \(!boardCanConfirm\(prizepicksData\)\) return matchupData;/)
  assert.doesNotMatch(s, /if \(!cards\.length\) return matchupData;/)
  assert.match(s, /if \(!Number\.isFinite\(liveLine\)\) return withoutLiveLine\(prop\);/)
  assert.match(s, /if \(!mappedStats\.length\) return cards\.length \? prop : withoutLiveLine\(prop\);/)
  // Starter K lines also clear when PrizePicks has no line.
  assert.match(s, /awayKLine\) \? awayKLine : null/)
  assert.match(s, /homeKLine\) \? homeKLine : null/)
  assert.match(s, /\.catch\(\(\) => \(\{ data: \{ cards: \[\], failed: true \}, updatedAt: null \}\)\)/)
})
