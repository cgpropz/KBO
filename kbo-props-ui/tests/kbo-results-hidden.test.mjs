import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memberRecapForTier, shapeForTier } from '../api/_dataAccess.js'

const root = fileURLToPath(new URL('..', import.meta.url))

const FORBIDDEN = [
  'Recent full-board results',
  'No full-board results',
  'full-board graded results',
  'full-board result',
  'Date (KST)',
  'What time zone are the results dates',
  'days with a summary',
  'KBO full-board results',
  'Graded results, including misses',
  'player rows',
  'Sep 24, 2026',
  'Sep 25, 2026',
  'Sep 26, 2026',
  'Sep 27, 2026',
  'Sep 29, 2026',
  'Sep 30, 2026',
  'Oct 1, 2026',
  'Oct 3, 2026',
  'Oct 4, 2026',
  'Oct 5, 2026',
  'Oct 6, 2026',
  'Oct 7, 2026',
  'Oct 9, 2026',
  'Oct 10, 2026',
  '15 | 13 | 1 | 8 | 0 | 42',
  '26 | 23 | 4 | 16 | 0 | 86',
  '14 | 13 | 2 | 21 | 0 | 87',
  '0 | 2 | 3 | 0 | 0 | 16',
]

const TEXT = new Set(['.html', '.js', '.mjs', '.xml', '.txt', '.json', '.svg'])

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out)
    else if (TEXT.has(name.slice(name.lastIndexOf('.')))) out.push(path)
  }
  return out
}

function hits(files) {
  const found = []
  for (const path of files) {
    const text = readFileSync(path, 'utf8')
    for (const phrase of FORBIDDEN) {
      if (text.includes(phrase)) found.push(`${relative(root, path)}: ${phrase}`)
    }
  }
  return found
}

test('public pages do not publish the KBO hit/miss results table', () => {
  assert.deepEqual(hits(walk(join(root, 'public'), [])), [])
})

test('the built site does not publish the KBO hit/miss results table', () => {
  const dist = join(root, 'dist')
  if (!existsSync(dist)) {
    if (process.env.CHECK_KBO_RESULTS_DIST === '1') assert.fail('dist is missing')
    return
  }
  const files = walk(dist, [])
  assert.equal(files.length > 0, true)
  assert.deepEqual(hits(files), [])
})

function filesNamed(dir, name, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'dist') continue
      filesNamed(path, name, out)
    } else if (entry === name) out.push(relative(root, path))
  }
  return out
}

test('member-recap.json is not a public file', () => {
  assert.deepEqual(filesNamed(join(root, 'public'), 'member-recap.json'), [])
})

test('member-recap.json is not in the built site', () => {
  const dist = join(root, 'dist')
  if (!existsSync(dist)) {
    if (process.env.CHECK_KBO_RESULTS_DIST === '1') assert.fail('dist is missing')
    return
  }
  assert.deepEqual(filesNamed(dist, 'member-recap.json'), [])
})

const HISTORY = {
  summary: { hits: 8, misses: 2, overall_hit_rate: 80 },
  graded: [{ player: 'A', result: 'HIT', odds_type: 'standard' }],
  pending: [{ player: 'Open', odds_type: 'standard' }],
}

const RECAP = {
  generated_at: '2026-10-14T00:00:00.000Z',
  sports: {
    kbo: { slate_date_iso: '2026-10-12', hits: 1, misses: 4, pushes: 0 },
    nfl: { slate_date_iso: '2026-10-12', hits: 40, misses: 26, pushes: 1 },
  },
}

function hitRateLeak(body) {
  const text = JSON.stringify(body)
  return ['"hits"', '"misses"', '"graded"', 'overall_hit_rate', 'hit_rate'].filter((phrase) => text.includes(phrase))
}

test('free and logged-out API responses omit graded history and hit-rate records', () => {
  for (const tier of ['free', 'discord']) {
    const shaped = shapeForTier('graded_props_history', structuredClone(HISTORY), tier)
    assert.equal(shaped.preview, true)
    assert.equal(shaped.data.graded, undefined)
    assert.equal(shaped.data.summary, undefined)
    assert.deepEqual(hitRateLeak(shaped.data), [])
    const recap = memberRecapForTier(RECAP, tier)
    assert.equal(recap.preview, true)
    assert.deepEqual(recap.data.sports, {})
    assert.deepEqual(hitRateLeak(recap.data), [])
  }
  const paid = memberRecapForTier(RECAP, 'kbo')
  assert.equal(paid.preview, false)
  assert.equal(paid.data.sports.kbo.hits, 1)
  assert.equal(paid.data.sports.nfl, undefined)
  const full = shapeForTier('graded_props_history', structuredClone(HISTORY), 'combined')
  assert.equal(full.preview, false)
  assert.equal(full.data.graded.length, 1)
})
