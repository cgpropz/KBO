import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CARD_TABLE_SELECTOR, cleanHeaderLabel, isHeadLabel } from '../src/tableCardLabels.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

test('header labels drop sort arrows and extra spaces', () => {
  assert.equal(cleanHeaderLabel('Opp K% ⇅'), 'Opp K%')
  assert.equal(cleanHeaderLabel('CG Projection ▼'), 'CG Projection')
  assert.equal(cleanHeaderLabel('Hit% \u21F5'), 'Hit%')
  assert.equal(cleanHeaderLabel('MIN ↓'), 'MIN')
  assert.equal(cleanHeaderLabel('  L5   5 gm '), 'L5 5 gm')
  assert.equal(cleanHeaderLabel(''), '')
})

test('the player cell and an empty header head the card unlabeled', () => {
  assert.equal(isHeadLabel(''), true)
  assert.equal(isHeadLabel('Player'), true)
  assert.equal(isHeadLabel('Name'), true)
  assert.equal(isHeadLabel('Stat', 0), true)
  assert.equal(isHeadLabel('Stat', 2), false)
  assert.equal(isHeadLabel('Opp Pitcher'), false)
  assert.equal(isHeadLabel('Team'), false)
})

test('cards cover the sport tables but not the boards with their own phone cards', () => {
  assert.match(CARD_TABLE_SELECTOR, /:is\(\.kbo-app-root, \.nfl-root, \.wnba-root\) table/)
  assert.match(CARD_TABLE_SELECTOR, /:not\(\.hit-rate-board\)/)
  assert.match(CARD_TABLE_SELECTOR, /:not\(\[data-testid="prop-line-table"\]\)/)
})

test('labels start at boot, only on the phone query', () => {
  const main = read('src/main.jsx')
  assert.match(main, /import \{ startTableCardLabels \} from '\.\/tableCardLabels\.js'/)
  assert.match(main, /\nstartTableCardLabels\(\)\n/)
  const js = read('src/tableCardLabels.js')
  assert.match(js, /import \{ PHONE_BOARD_QUERY \} from '\.\/phoneBoardQuery\.js'/)
  assert.match(js, /matchMedia\(PHONE_BOARD_QUERY\)/)
  // Attributes only: the labeler never writes text or moves cells. (It
  // reads header text from a detached clone.)
  for (const write of ['textContent =', 'innerHTML', 'appendChild', 'insertBefore', 'replaceChildren']) {
    assert.equal(js.includes(write), false, write)
  }
})

test('the phone stylesheet prints labels and lays cards two per row', () => {
  const css = read('src/mobile.css')
  const phone = css.slice(css.indexOf('@media (--phone-board) {'), css.indexOf('/* A mouse window in this range is not a phone'))
  assert.match(phone, /table\[data-card-table\] > tbody \{\s*display: grid !important;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.match(phone, /\[data-label\]::before \{\s*content: attr\(data-label\);/)
  assert.match(phone, /\.so-scroll-hint \{\s*display: none !important;/)
  // Nothing outside the phone query touches the labeled tables.
  assert.equal(css.replace(phone, '').includes('data-card-table'), false)
})

test('the Batter and Pitcher Props line column has a readable label', () => {
  for (const file of ['src/BatterProjections.jsx', 'src/StrikeoutProjections.jsx']) {
    assert.match(read(file), /<th onClick=\{\(\) => handleSort\('line'\)\} className="col-num" data-label="PP Line">/)
  }
})

test('phone card nits from #319 review stay fixed', () => {
  const css = read('src/mobile.css')
  const phone = css.slice(css.indexOf('@media (--phone-board) {'), css.indexOf('/* A mouse window in this range is not a phone'))
  // Labels keep their header case (NBA Edge cells lowercase their value).
  assert.match(phone, /\[data-label\]::before \{[^}]*text-transform: none;/)
  // No second "CG Odds" label over the CG ODDS panel.
  assert.match(phone, /td\.nfl-sharp-cg\[data-label\]::before \{\s*content: none;/)
  // Matchups last-5 dates and team names do not split mid-word.
  assert.match(phone, /table\.mdd-recent-table\[data-card-table\] > tbody > tr > td \{\s*overflow-wrap: normal;\s*white-space: nowrap !important;/)
  // Date and opponent each get the full card width, so they fit at 320px.
  assert.match(phone, /table\.mdd-recent-table\[data-card-table\] > tbody > tr > td:nth-child\(-n \+ 2\) \{\s*grid-column: 1 \/ -1;/)
  // Pitcher Rankings cards lead with the pitcher's name.
  assert.match(phone, /table\.rk-table\[data-card-table\] > tbody > tr > td\.col-player \{\s*order: -1;/)
})
