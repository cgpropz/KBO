import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const FORBIDDEN = [
  '÷ line',
  '× 50',
  '/ line * 50',
  'times 50',
  'L3 50%',
  'L9 25%',
  'L15 25%',
  'L5 25%',
  'L10 25%',
  '0.5/0.3/0.2',
  'L3 x 0.5',
  'L7 x 0.3',
  'L15 x 0.2',
]

const TEXT = new Set(['.html', '.md', '.mjs', '.js', '.jsx', '.css', '.json', '.svg', '.txt'])

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

test('public pages, guides, and the page generator keep the score formula private', () => {
  const files = [
    ...walk(join(root, 'public'), []),
    ...walk(join(root, 'content'), []),
    join(root, 'scripts', 'publicPages.mjs'),
    join(root, 'scripts', 'markdownGuide.mjs'),
  ]
  const hits = []
  for (const path of files) {
    const text = readFileSync(path, 'utf8')
    for (const phrase of FORBIDDEN) {
      if (text.includes(phrase)) hits.push(`${relative(root, path)}: ${phrase}`)
    }
  }
  assert.deepEqual(hits, [])
  const guide = readFileSync(join(root, 'public', 'guides', 'cg-score.html'), 'utf8')
  assert.match(guide, /adjusted for the matchup and recent form/)
  assert.match(guide, /Check an extreme score/)
  assert.equal(guide.includes('how far does our projection sit from the line'), false)
  assert.equal(guide.includes('very low line'), false)
})
