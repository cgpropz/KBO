import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

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
