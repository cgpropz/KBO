// Opponent-adjusted NFL matchup context (nflverse). Mapping, lookup, tooltip
// credit, free dataset registration, and no hook into CG Score / projections.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalTeam, coverageLabel, matchupEntries, matchupSummary, matchupTitle, matchupTooltip, smallSampleNote, splitsForProp } from '../src/nfl/matchupDefenseModel.js'
import { DATASETS, datasetIsFullyPublic, shapeForTier } from '../api/_dataAccess.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nfl-matchup-prop-map.json', import.meta.url), 'utf8'))

function team(rank, extra = {}) {
  const row = (r) => ({ rank: r, grade: null, epa: 0.12, success: 0.48, plays: 90, smallSample: false, ...extra })
  return { pass: row(rank), run: row(33 - rank), WR: row(rank), TE: row(rank), RB: row(rank) }
}

const payload = { throughWeek: 6, credit: 'Data: nflverse', teams: { JAX: team(29), LA: team(3, { smallSample: true, plays: 17 }), WAS: team(16) } }

test('prop mapping matches the shared fixture (same cases as the Python builder)', () => {
  for (const c of fixture.cases) assert.deepEqual(splitsForProp(c.prop, c.position), c.splits, JSON.stringify(c))
})

test('team aliases match nflverse codes', () => {
  assert.equal(canonicalTeam('JAC'), 'JAX')
  assert.equal(canonicalTeam('LAR'), 'LA')
  assert.equal(canonicalTeam('WSH'), 'WAS')
  assert.equal(canonicalTeam('@jax'), 'JAX')
})

test('entries carry rank and the matchupGrade.js grade', () => {
  const [wr] = matchupEntries(payload, { prop: 'Receiving Yards', position: 'WR', opponent: 'JAC' })
  assert.equal(wr.split, 'WR')
  assert.equal(wr.rank, 29)
  assert.equal(wr.grade, 'A+')
  const both = matchupEntries(payload, { prop: 'Rush+Rec Yds', position: 'RB', opponent: 'JAX' })
  assert.deepEqual(both.map((e) => e.split), ['run', 'RB'])
  assert.deepEqual(matchupEntries(payload, { prop: 'Fantasy Score', position: 'WR', opponent: 'JAX' }), [])
  assert.deepEqual(matchupEntries(null, { prop: 'Rush Yards', position: 'RB', opponent: 'JAX' }), [])
  assert.deepEqual(matchupEntries(payload, { prop: 'Rush Yards', position: 'RB', opponent: 'XXX' }), [])
})

test('tooltip credits nflverse, flags small samples and says it is not in CG Score', () => {
  const [entry] = matchupEntries(payload, { prop: 'Receptions', position: 'TE', opponent: 'LAR' })
  const text = matchupTooltip(entry, payload)
  assert.match(text, /Data: nflverse/)
  assert.match(text, /Small sample/)
  assert.match(text, /not part of CG Score/)
  assert.match(text, /Through Week 6/)
})

// Board QA cases: NYG RB targets 17 plays (A+), WAS / LV 21-29 plays (A+ / A).
const qaPayload = {
  throughWeek: 6,
  weekLabel: 'through Week 5 (+ Thu Wk 6)',
  teams: {
    NYG: { ...team(10), RB: { rank: 32, epa: 0.2, success: 0.5, plays: 17, smallSample: true } },
    WAS: { ...team(10), RB: { rank: 30, epa: 0.2, success: 0.5, plays: 29, smallSample: true } },
    LV: { ...team(10), RB: { rank: 28, epa: 0.2, success: 0.5, plays: 21, smallSample: true } },
    DEN: team(5),
  },
}

test('small-sample flag is set when ANY split behind the chip is small', () => {
  // RB Rush+Rec: Run D (90 plays, fine) first, RB targets (17 plays) second.
  const rushRec = matchupEntries(qaPayload, { prop: 'Rush+Rec Yds', position: 'RB', opponent: 'NYG' })
  assert.deepEqual(rushRec.map((e) => e.split), ['run', 'RB'])
  assert.equal(rushRec[0].smallSample, false)
  const summary = matchupSummary(rushRec)
  assert.equal(summary.smallSample, true)
  // The chip shows the Run D grade, so the asterisk names the thin split.
  assert.equal(summary.marker, '*RB')
  assert.deepEqual(summary.smallSplits, ['RB tgts'])
  const title = matchupTitle(rushRec, qaPayload)
  assert.equal((title.match(/Data: nflverse\./g) || []).length, 1)
  assert.match(title, /Run D: 23\/32[\s\S]*vs RB targets: 32\/32[\s\S]*Small sample \(under 30 plays: RB tgts 17 plays\)[\s\S]*Data: nflverse\.$/)
  assert.match(smallSampleNote(rushRec), /^\* Small sample \(under 30 plays: RB tgts 17 plays\)/)
  for (const [opp, grade] of [['NYG', 'A+'], ['WAS', 'A+'], ['LV', 'A']]) {
    const entries = matchupEntries(qaPayload, { prop: 'Receiving Yards', position: 'RB', opponent: opp })
    const s = matchupSummary(entries)
    assert.equal(s.grade, grade, opp)
    assert.equal(s.marker, '*', opp)
  }
  const fine = matchupSummary(matchupEntries(qaPayload, { prop: 'Rush+Rec Yds', position: 'RB', opponent: 'DEN' }))
  assert.equal(fine.smallSample, false)
  assert.equal(fine.marker, '')
  assert.equal(matchupTitle([], qaPayload), '')
  assert.equal(smallSampleNote(matchupEntries(qaPayload, { prop: 'Rush+Rec Yds', position: 'RB', opponent: 'DEN' })), '')
  assert.equal(matchupSummary([]), null)
})

test('chip and tile render the marker and mute small-sample grades', () => {
  const jsx = readFileSync(new URL('../src/nfl/MatchupDefense.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /matchupSummary\(entries\)/)
  assert.match(jsx, /summary\.marker/)
  assert.equal((jsx.match(/matchupTitle\(entries, payload\)/g) || []).length, 2)
  // The muted class comes from ANY split (summary), never only the first one.
  assert.equal((jsx.match(/summary\.smallSample \? ' small-sample' : ''/g) || []).length, 2)
  assert.doesNotMatch(jsx, /first\.smallSample \? ' small-sample'/)
  const css = readFileSync(new URL('../src/nfl/matchupDefenseChip.css', import.meta.url), 'utf8')
  assert.match(css, /\.nfl-adj-chip\.small-sample:is\(\.adj-a, \.adj-b, \.adj-c, \.adj-d\) \{ color: #a1a1aa;/)
  assert.doesNotMatch(css, /small-sample \{ opacity/)
})

test('coverage label comes from the data, and the open note credits nflverse once', () => {
  assert.equal(coverageLabel(qaPayload), 'through Week 5 (+ Thu Wk 6)')
  assert.equal(coverageLabel({ throughWeek: 7 }), 'through Week 7')
  assert.equal(coverageLabel({}), '')
  const [entry] = matchupEntries(qaPayload, { prop: 'Pass Yards', position: 'QB', opponent: 'DEN' })
  assert.match(matchupTooltip(entry, qaPayload), /Through Week 5 \(\+ Thu Wk 6\)\./)
  assert.match(matchupTooltip(entry, qaPayload), /Data: nflverse/)
  // The open note shows the credit as a link, so its text leaves it out.
  assert.doesNotMatch(matchupTooltip(entry, qaPayload, { credit: false }), /nflverse/)
  const jsx = readFileSync(new URL('../src/nfl/MatchupDefense.jsx', import.meta.url), 'utf8')
  assert.equal((jsx.match(/Data: nflverse/g) || []).length, 1)
})

test('nfl_matchup_defense is a registered, fully free NFL dataset', () => {
  assert.equal(DATASETS.nfl_matchup_defense.table, 'nfl_matchup_defense')
  assert.equal(DATASETS.nfl_matchup_defense.sport, 'nfl')
  assert.equal(datasetIsFullyPublic('nfl_matchup_defense'), true)
  const shaped = shapeForTier('nfl_matchup_defense', payload, 'free')
  assert.equal(shaped.preview, false)
  assert.deepEqual(shaped.data, payload)
  const anon = shapeForTier('nfl_matchup_defense', payload, null)
  assert.equal(anon.preview, false)
})

test('CG Score, projections and the totals ranking do not read the matchup data', () => {
  for (const file of ['../src/nfl/nflLineFloors.js', '../src/nfl/cgOdds.js', '../src/nfl/gameCardModel.js', '../api/_dataAccess.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    const uses = src.split('\n').filter((line) => /matchupDefense|matchup_defense/.test(line) && !/nfl_matchup_defense: \{/.test(line) && !/^\s*\/\//.test(line))
    assert.deepEqual(uses, [], `${file} must not use matchup defense`)
  }
})
