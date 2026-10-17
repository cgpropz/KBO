import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildMemberRecap } from '../scripts/write-member-recap.mjs'

function writeDay(root, sport, iso, name, body) {
  const [yyyy, mm, dd] = iso.split('-')
  const dir = join(root, sport, mm, dd, yyyy)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(body))
}

test('member recap is empty until a day has a corrected standard-only summary', () => {
  const root = mkdtempSync(join(tmpdir(), 'member-recap-'))
  const now = new Date('2026-10-17T17:00:00Z')
  try {
    const staleProps = [
      { odds_type: 'standard', model_result: 'HIT' },
      { odds_type: 'standard', model_result: 'HIT' },
      { odds_type: 'demon', model_result: 'HIT' },
      { odds_type: 'goblin', model_result: 'MISS' },
    ]
    writeDay(root, 'nhl', '2026-10-16', 'recap.json', {
      slate_date_iso: '2026-10-16',
      graded_at: '2026-10-17T14:00:00Z',
      props: staleProps,
    })
    writeDay(root, 'nhl', '2026-10-16', 'summary.json', {
      slate_date_iso: '2026-10-16',
      hits: 135,
      misses: 40,
      pushes: 5,
      updated_at: '2026-10-17T14:00:00Z',
    })
    writeDay(root, 'wnba', '2026-09-27', 'recap.json', { props: staleProps })
    writeDay(root, 'wnba', '2026-09-27', 'summary.json', {
      hits: 803,
      misses: 551,
      pushes: 8,
      correction: '   ',
    })

    const before = buildMemberRecap(root, now)
    assert.deepEqual(before.sports, {})

    writeDay(root, 'nhl', '2026-10-15', 'recap.json', { props: staleProps })
    writeDay(root, 'nhl', '2026-10-15', 'summary.json', {
      slate_date_iso: '2026-10-15',
      hits: 62,
      misses: 56,
      pushes: 4,
      voids: 10,
      updated_at: '2026-10-17T16:58:00Z',
      correction: 'Corrected 2026-10-17. Stale swapped-out rows and pulled lines removed. Standard-only.',
    })

    const older = buildMemberRecap(root, now)
    assert.deepEqual(older.sports, {
      nhl: {
        slate_date_iso: '2026-10-15',
        graded_at: '2026-10-17T16:58:00Z',
        hits: 62,
        misses: 56,
        pushes: 4,
      },
    })

    writeDay(root, 'nhl', '2026-10-16', 'summary.json', {
      slate_date_iso: '2026-10-16',
      hits: 10,
      misses: 14,
      pushes: 5,
      voids: 2,
      updated_at: '2026-10-17T16:58:21Z',
      correction: 'Corrected 2026-10-17. Stale swapped-out rows and pulled lines removed. Standard-only.',
    })
    const latest = buildMemberRecap(root, now)
    assert.equal(latest.sports.nhl.slate_date_iso, '2026-10-16')
    assert.equal(latest.sports.nhl.hits, 10)
    assert.equal(latest.sports.nhl.misses, 14)
    assert.equal(latest.sports.nhl.pushes, 5)
    assert.equal(latest.sports.wnba, undefined)
    assert.equal(latest.generated_at, '2026-10-17T17:00:00.000Z')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
