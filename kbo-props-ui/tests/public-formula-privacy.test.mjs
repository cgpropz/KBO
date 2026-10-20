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

const STANDARD_LINE_FORBIDDEN = [
  'demon and goblin lines alongside',
  'separate tabs',
  '{{',
]

function lineTypeHits(files) {
  const hits = []
  for (const path of files) {
    if (!path.endsWith('.html')) continue
    const text = readFileSync(path, 'utf8')
    for (const phrase of STANDARD_LINE_FORBIDDEN) {
      if (text.includes(phrase)) hits.push(`${relative(root, path)}: ${phrase}`)
    }
  }
  return hits
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
  assert.match(guide, /how far does our projection sit from the line/)
  assert.match(guide, /How to read a CG Score: below, around and above 50/)
  assert.match(guide, /src="\/images\/cg-score-scale-v2\.png"/)
  assert.match(guide, /<h2>What the number means<\/h2>/)
  assert.equal(guide.includes('How the score is calculated'), false)
  assert.match(guide, /name="description" content="CG Score ranks every prop by how strongly the model projection disagrees with the line\. Higher score means a bigger model edge\. 21\+\."/)
  assert.match(guide, /property="og:image:alt" content="How CG Score works: a higher score is a bigger gap between projection and line\."/)
  const article = guide.match(/"@type":"Article","headline":"How CG Score Works","description":"([^"]+)"/)
  assert.ok(article)
  assert.match(article[1], /bigger gap between projection and line/)
  assert.equal(article[1].includes('bigger model edge'), false)
  assert.equal(guide.includes('how-cg-score-diagram'), false)
  assert.equal(guide.includes('A+ through C'), false)
  assert.equal(guide.includes('smaller model edge'), false)

  const explainerJsx = readFileSync(join(root, 'src', 'CgScoreExplainer.jsx'), 'utf8')
  const explainerJs = readFileSync(join(root, 'src', 'cgScoreExplainer.js'), 'utf8')
  assert.match(explainerJsx, /Scores on very small lines are adjusted\./)
  assert.match(explainerJs, /Scores on very small lines are adjusted\./)
  assert.equal(explainerJsx.includes('Score capped because the line is small.'), false)
  assert.equal(explainerJs.includes('Score capped because the line is small.'), false)
})

test('built public pages show standard lines only and publish no placeholders', () => {
  const files = walk(join(root, 'public'), []).filter((path) => path.endsWith('.html'))
  assert.deepEqual(lineTypeHits(files), [])

  const guide = readFileSync(join(root, 'public', 'guides', 'cg-score.html'), 'utf8')
  assert.match(guide, /Every CGPropz board shows standard lines only\. Demon and goblin lines aren't on the boards\./)
  assert.match(guide, /On NHL and WNBA, the free top 3 is chosen from the standard lines on the board, ranked by CG Score\./)
  assert.match(guide, /KBO's free top 3 is also ranked by CG Score from the standard lines on the board\./)
  assert.match(guide, /NFL and NBA have no free top 3 right now\./)
  assert.equal(guide.includes('opens Tuesday, Oct 20'), false)

  const nba = readFileSync(join(root, 'public', 'nba-player-props.html'), 'utf8')
  assert.match(nba, /<strong>Line types:<\/strong> The board shows standard lines only\./)
  assert.match(nba, /The board shows standard lines only, with every prop available to All-Access members\./)
  assert.equal(nba.includes('Double-Double'), false)
  assert.equal(nba.includes('Triple-Double'), false)

  const wnba = readFileSync(join(root, 'public', 'wnba-player-props.html'), 'utf8')
  assert.equal(wnba.includes('alongside standard lines'), false)

  const start = readFileSync(join(root, 'public', 'guides', 'start-here.html'), 'utf8')
  assert.match(start, /A goblin \(green icon\) is an easier projection with a lower payout\./)
  assert.match(start, /A demon \(red icon\) is a harder projection with a higher potential payout\./)
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
  assert.deepEqual(lineTypeHits(files), [])
})
