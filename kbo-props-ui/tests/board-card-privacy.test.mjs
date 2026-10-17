import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { opponentLabel } from '../src/cardMark.js'
import { wnbaLogoUrl } from '../src/slipBoardModel.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const FORBIDDEN = [
  'Projection = L3 50% + L9 25% + L15 25%',
  'SCORE SCALE',
  'L3 x 0.5 + L7 x 0.3 + L15 x 0.2',
  '0.5/0.3/0.2',
  'Score = (Projection / Line) × 50',
  '(H/IP x IP/G)',
  '(SO/IP x IP/G)',
  '(IP/G x 3)',
  'TB/G × (Opp Team TB/G',
  'FS = 3×1B',
  'active pitcher model formula',
  'clamped to 0.85',
]

const CARD_FILES = [
  'src/nfl/NflPropLines.jsx',
  'src/nfl/NflProjections.jsx',
  'src/nhl/NhlPropLines.jsx',
  'src/nhl/NhlProjections.jsx',
  'src/wnba/Dashboard.jsx',
  'src/wnba/Projections.jsx',
  'src/nba/NbaDashboard.jsx',
  'src/nba/NbaEdge.jsx',
  'src/KboPropBoard.jsx',
  'src/StrikeoutProjections.jsx',
  'src/BatterProjections.jsx',
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.(js|jsx|mjs|css|html|json)$/.test(entry.name)) out.push(path)
  }
  return out
}

test('opponent text is labeled vs the other team', () => {
  assert.equal(opponentLabel('JAX'), 'vs JAX')
  assert.equal(opponentLabel(' PIT '), 'vs PIT')
  assert.equal(opponentLabel(''), '')
  assert.equal(opponentLabel(null), '')
})

test('member boards keep the live-model label and drop projection weights', () => {
  const files = ['src', 'api', 'public'].flatMap((dir) => walk(join(ROOT, dir)))
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const phrase of FORBIDDEN) {
      if (text.includes(phrase)) hits.push(`${file} contains ${phrase}`)
    }
  }
  assert.deepEqual(hits, [])
  const nflBoard = readFileSync(join(ROOT, 'src/nfl/NflProjections.jsx'), 'utf8')
  assert.match(nflBoard, /LIVE MODEL \/ DVP ADJUSTED/)
  const wnba = readFileSync(join(ROOT, 'src/wnba/Projections.jsx'), 'utf8')
  const nba = readFileSync(join(ROOT, 'src/nba/NbaEdge.jsx'), 'utf8')
  assert.match(wnba, /Live model \/ DvP adjusted/)
  assert.match(nba, /Live model \/ DvP adjusted/)
})

test('WNBA cards use ESPN logos and a failed logo hides', () => {
  assert.match(wnbaLogoUrl('ATL'), /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/wnba\/500\/atl\.png$/)
  assert.match(wnbaLogoUrl('GSV'), /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/wnba\/500\/gs\.png$/)
  assert.equal(wnbaLogoUrl(''), '')
  const logo = readFileSync(join(ROOT, 'src/CardTeamLogo.jsx'), 'utf8')
  assert.match(logo, /onError=\{\(\) => setFailedSrc\(src\)\}/)
  assert.match(logo, /src === failedSrc\) return null/)
  for (const file of ['src/wnba/Dashboard.jsx', 'src/wnba/Projections.jsx']) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    assert.match(text, /wnbaLogoUrl\(/, file)
    assert.doesNotMatch(text, /\/logos\//, file)
  }
})

test('every member card logo is the player team and the opponent is labeled', () => {
  for (const file of CARD_FILES) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    assert.match(text, /CardTeamLogo team=\{/, file)
    assert.doesNotMatch(text, /CardTeamLogo team=\{[^}]*opponent/, file)
    assert.match(text, /opponentLabel\(/, file)
    assert.doesNotMatch(text, /teamLogoUrl\([^)]*opponent/, file)
    assert.doesNotMatch(text, /TeamLogo team=\{[^}]*opponent/, file)
  }
})
