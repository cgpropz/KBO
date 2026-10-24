import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyPhoneBoardMedia } from '../phoneMediaPlugin.js'
import { PHONE_BOARD_QUERY } from '../src/phoneBoardQuery.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the phone board and the phone stylesheet share one query', () => {
  assert.equal(
    PHONE_BOARD_QUERY,
    '(max-width: 767px), (hover: none) and (pointer: coarse) and (max-device-width: 1000px) and (max-device-height: 1000px)',
  )
  const hook = readFileSync(join(root, 'src/usePhoneBoard.js'), 'utf8')
  assert.match(hook, /import \{ PHONE_BOARD_QUERY \} from '\.\/phoneBoardQuery\.js'/)
  assert.match(hook, /export \{ PHONE_BOARD_QUERY \}/)
  assert.match(hook, /matchMedia\(PHONE_BOARD_QUERY\)/)
  assert.match(hook, /typeof window === 'undefined' \|\| typeof window\.matchMedia !== 'function'/)
  assert.match(hook, /useState\(phoneNow\)/)
  const css = readFileSync(join(root, 'src/mobile.css'), 'utf8')
  assert.match(css, /@media \(--phone-board\)/)
  assert.equal(css.includes('@media (max-width: 767px)'), false)
  const built = applyPhoneBoardMedia(css)
  assert.equal(built.includes('@media (--phone-board)'), false)
  assert.equal(built.includes(`@media ${PHONE_BOARD_QUERY}`), true)
  const menu = built.slice(built.indexOf(`@media ${PHONE_BOARD_QUERY}`))
  assert.match(menu, /\.cg-menu-btn \{/)
})

test('phone hub L10 is not a query container, so WebKit cannot clip the date row', () => {
  const css = readFileSync(join(root, 'src/mobile.css'), 'utf8')
  const phone = css.slice(css.indexOf('@media (--phone-board)'))
  assert.match(phone, /body \.hub-chart-block \{[^}]*container-type: normal !important/)
  assert.match(phone, /body \.hub-chart-block \{[^}]*overflow: visible !important/)
  assert.match(phone, /body \.hub-chart-block \.mini-hit-dates \{[^}]*min-height: 32px !important/)
  assert.match(phone, /body \.hub-chart-block \.mini-hit-dates \{[^}]*overflow: visible !important/)
  assert.match(phone, /body \.hub-chart-block \.hr-game-date \{[^}]*-webkit-text-fill-color: #a1a1aa !important/)
  assert.match(phone, /body \.hub-chart-block \.hr-game-logo \{[^}]*min-height: 14px !important/)
})

test('the NFL/NHL edge grid goes two-up on the phone query, not on a width query', () => {
  const nfl = readFileSync(join(root, 'src/nfl/nfl.css'), 'utf8')
  // A desktop-site or zoomed iPhone lays out at 980px, so a max-width rule
  // alone left the shared edge grid on the 3-column tablet rule.
  assert.match(nfl, /@media \(--phone-board\) \{ \.nfl-root \.nfl-edge-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important; \} \}/)
  assert.ok(nfl.indexOf('@media (--phone-board)') > nfl.indexOf('@media (max-width: 760px)'), 'phone rule must follow the 760px one-column rule')
  assert.equal(/max-width: 480px\) \{ \.nfl-root:not\(\.nhl-root\) \.nfl-edge-grid/.test(nfl), false)
  const built = applyPhoneBoardMedia(nfl)
  assert.equal(built.includes('@media (--phone-board)'), false)
})
