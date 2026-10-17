import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const FORBIDDEN = [
  '÷ line',
  '× 50',
  '×50',
  '/ line * 50',
  'times 50',
  'divided by',
  'multiplied by',
  'max(line',
  '50 means',
  'per-stat floor',
  'minimum',
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

function walk(dir, out, { suffixes = null } = {}) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out, { suffixes })
    else if (suffixes ? suffixes.some((ext) => name.endsWith(ext)) : TEXT.has(name.slice(name.lastIndexOf('.')))) out.push(path)
  }
  return out
}

function textForPhrase(path, text, phrase) {
  if (phrase !== 'minimum') return text
  // Intl.NumberFormat's option name is not a published line minimum.
  let scan = text.replaceAll('minimumFractionDigits', '')
  // The draft notes in cg-score.md tell the publisher not to print line minimums.
  // Those HTML comments are not the page. The published copy still cannot say "minimum".
  if (path.endsWith(join('content', 'guides', 'cg-score.md'))) {
    scan = scan.replace(/<!--[\s\S]*?-->/g, '')
  }
  return scan
}

function formulaHits(files) {
  const hits = []
  for (const path of files) {
    const text = readFileSync(path, 'utf8')
    for (const phrase of FORBIDDEN) {
      if (textForPhrase(path, text, phrase).includes(phrase)) hits.push(`${relative(root, path)}: ${phrase}`)
    }
  }
  return hits
}

test('public pages, guides, and the page generator keep the score formula private', () => {
  const files = [
    ...walk(join(root, 'public'), []),
    ...walk(join(root, 'content'), []),
    join(root, 'scripts', 'publicPages.mjs'),
    join(root, 'scripts', 'markdownGuide.mjs'),
  ]
  assert.deepEqual(formulaHits(files), [])
  const guide = readFileSync(join(root, 'public', 'guides', 'cg-score.html'), 'utf8')
  assert.match(guide, /adjusted for the matchup and recent form/)
  assert.match(guide, /Check an extreme score/)
  assert.match(guide, /under side of the projection vs the line/)
  assert.match(guide, /No\. It is tuned by sport\. It is still projection vs line, adjusted for matchup\./)
  assert.equal(guide.includes('how far does our projection sit from the line'), false)
  assert.equal(guide.includes('very low line'), false)
  assert.equal(guide.includes('smaller model edge'), false)
})

test('the built site JS does not publish the score formula', () => {
  const dist = join(root, 'dist')
  if (!existsSync(dist)) {
    if (process.env.CHECK_FORMULA_DIST === '1') assert.fail('dist is missing')
    return
  }
  const files = walk(dist, [], { suffixes: ['.js', '.html'] })
  assert.equal(files.length > 0, true)
  assert.deepEqual(formulaHits(files), [])
})
