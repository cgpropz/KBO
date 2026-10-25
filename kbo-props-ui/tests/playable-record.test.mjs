import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PLAYABLE_RECORD_LABEL,
  formatPlayablePct,
  freeTop3Picks,
  isPulled,
  oddsKey,
  playablePicks,
  playableRecordDetail,
  playableRecordText,
  playableSlate,
  playableTotals,
  tallyPicks,
} from '../src/playableRecord.js'

const LOCK = '2026-10-24T00:00:00Z'
const EARLY = '2026-10-22T22:52:19Z'
const MID = '2026-10-23T15:48:53Z'
const LATE = '2026-10-23T22:51:51Z'

function row(over) {
  return {
    sport: 'NHL',
    slate_date: '2026-10-23',
    player: 'Skater',
    prop: 'Shots On Goal',
    line: 1.5,
    odds_type: 'standard',
    snapshot_at: MID,
    start_time: LOCK,
    result: 'Hit',
    free_top3: false,
    raw: {},
    ...over,
  }
}

test('odds key falls back to raw line_type, then standard', () => {
  assert.equal(oddsKey({ odds_type: 'Demon' }), 'demon')
  assert.equal(oddsKey({ odds_type: '  ', raw: { line_type: 'goblin' } }), 'goblin')
  assert.equal(oddsKey({ odds_type: null, raw: {} }), 'standard')
})

test('pulled is removed >= true or a held pp_status', () => {
  assert.equal(isPulled({ raw: { removed: true } }), true)
  assert.equal(isPulled({ raw: { removed: 1 } }), true)
  assert.equal(isPulled({ raw: { removed: 'true' } }), false)
  assert.equal(isPulled({ raw: { removed: false, pp_status: 'On Hold' } }), true)
  assert.equal(isPulled({ raw: { pp_status: 'superseded' } }), true)
  assert.equal(isPulled({ raw: {} }), false)
})

test('filters match the Oct 23 NHL rules', () => {
  const rows = [
    // Later demon does not supersede the standard line, and does not count.
    row({ id: 1, player: 'Nathan MacKinnon', line: 3.5, snapshot_at: EARLY, result: 'Hit' }),
    row({ id: 2, player: 'Nathan MacKinnon', line: 7.5, odds_type: 'demon', snapshot_at: LATE, result: 'Hit' }),
    // Older standard line beside a newer standard line is superseded.
    row({ id: 3, player: 'Moved', line: 1.5, snapshot_at: EARLY, result: 'Hit' }),
    row({ id: 4, player: 'Moved', line: 2.5, snapshot_at: MID, result: 'Miss' }),
    // Latest pulled row is Void. The earlier free_top3 flag does not count.
    row({ id: 5, player: 'Artturi Lehkonen', snapshot_at: EARLY, result: 'Miss', free_top3: true }),
    row({ id: 6, player: 'Artturi Lehkonen', snapshot_at: MID, result: 'Void', free_top3: false, raw: { removed: true, pp_status: 'removed' } }),
    // Post-lock snapshot is not the pre-lock row.
    row({ id: 7, player: 'Late', snapshot_at: '2026-10-24T02:00:00Z', result: 'Hit' }),
    // Goblin under stays out.
    row({ id: 8, player: 'Goblin', odds_type: 'goblin', result: 'Hit' }),
    // NFL line_type fallback: demon out, blank type counts as standard.
    row({ id: 9, sport: 'NFL', slate_date: '2026-10-19', player: 'Demon', odds_type: null, raw: { line_type: 'demon' }, result: 'Hit' }),
    row({ id: 10, sport: 'NFL', slate_date: '2026-10-19', player: 'Blank', odds_type: '', raw: {}, result: 'Miss' }),
    // Free top 3 on the surviving standard row.
    row({ id: 11, player: 'Tyler Bertuzzi', result: 'Miss', free_top3: true }),
    row({ id: 12, player: 'T.J. Hughes', result: 'Hit', free_top3: true }),
    row({ id: 13, player: 'Patrick Kane', result: 'Hit', free_top3: true }),
  ]
  const kept = playablePicks(rows)
  const names = kept.map((item) => item.player).sort()
  assert.deepEqual(names, ['Blank', 'Moved', 'Nathan MacKinnon', 'Patrick Kane', 'T.J. Hughes', 'Tyler Bertuzzi'])
  const nhl = tallyPicks(kept.filter((item) => String(item.sport).toLowerCase() === 'nhl'))
  assert.equal(nhl.wins, 3)
  assert.equal(nhl.losses, 2)
  const free = tallyPicks(freeTop3Picks(kept))
  assert.deepEqual(free, { wins: 2, losses: 1, hit_pct: 2 / 3 })
  assert.equal(formatPlayablePct(14 / 30), '46.6%')
  assert.equal(formatPlayablePct(2 / 3), '66.6%')
})

test('the baked NHL Oct 23 snapshot is the Board QA check', () => {
  const file = JSON.parse(readFileSync(new URL('../api/_playableRecord.json', import.meta.url), 'utf8'))
  assert.equal(file.label, PLAYABLE_RECORD_LABEL)
  assert.equal(file.source, 'public.qa_pick_ledger')
  assert.equal(JSON.stringify(file).toLowerCase().includes('board record'), false)
  const slate = playableSlate(file, { sport: 'nhl', slateDate: '2026-10-23' })
  assert.equal(slate.wins, 14)
  assert.equal(slate.losses, 16)
  assert.equal(slate.hit_pct, 14 / 30)
  assert.equal(formatPlayablePct(slate.hit_pct), '46.6%')
  assert.equal(slate.free_top3.wins, 2)
  assert.equal(slate.free_top3.losses, 1)
  assert.deepEqual(slate.free_top3.picks.map((pick) => `${pick.player} ${pick.result}`), [
    'Patrick Kane Hit',
    'T.J. Hughes Hit',
    'Tyler Bertuzzi Miss',
  ])
  assert.equal(playableRecordText(slate), 'Playable record Oct 23 14-16 (46.6%) · Free top 3 2-1')
  const detail = playableRecordDetail(slate)
  assert.equal(detail.line, playableRecordText(slate))
  assert.equal(detail.n, 30)
  assert.match(detail.note, /30 decided standard lines/)
  assert.match(detail.note, /Push, Void, and Ungraded are excluded/)
  assert.match(detail.note, /Demon and goblin lines, including unders/)
  assert.match(detail.note, /not a record versus the book/)
  assert.equal(playableSlate(file, { sport: 'NHL' }).slate_date, '2026-10-23')
  const day = playableTotals(file, { sport: 'nhl', slateDate: '2026-10-23' })
  assert.equal(day.wins, 14)
  assert.equal(day.losses, 16)
})

test('the landing and the hub label the ledger record Playable record', () => {
  const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
  const hub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')
  const line = readFileSync(new URL('../src/PlayableRecord.jsx', import.meta.url), 'utf8')
  assert.match(landing, /PlayableRecord/)
  assert.ok(landing.indexOf('id="free-top-3"') < landing.indexOf('id="boards"'))
  assert.ok(landing.indexOf('id="boards"') < landing.indexOf('<PlayableRecord'))
  assert.match(landing, /detailed/)
  assert.match(line, /playableRecordText/)
  assert.match(line, /playableRecordDetail/)
  assert.match(hub, /playableSlate/)
  for (const source of [landing, hub, line]) {
    assert.equal(/board record/i.test(source), false)
  }
})
