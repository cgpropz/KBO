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
    '(max-width: 767px), (hover: none) and (pointer: coarse) and (max-device-width: 932px)',
  )
  const hook = readFileSync(join(root, 'src/usePhoneBoard.js'), 'utf8')
  assert.match(hook, /import \{ PHONE_BOARD_QUERY \} from '\.\/phoneBoardQuery\.js'/)
  assert.match(hook, /export \{ PHONE_BOARD_QUERY \}/)
  assert.match(hook, /matchMedia\(PHONE_BOARD_QUERY\)/)
  const css = readFileSync(join(root, 'src/mobile.css'), 'utf8')
  assert.match(css, /@media \(--phone-board\)/)
  assert.equal(css.includes('@media (max-width: 767px)'), false)
  const built = applyPhoneBoardMedia(css)
  assert.equal(built.includes('@media (--phone-board)'), false)
  assert.equal(built.includes(`@media ${PHONE_BOARD_QUERY}`), true)
  const menu = built.slice(built.indexOf(`@media ${PHONE_BOARD_QUERY}`))
  assert.match(menu, /\.cg-menu-btn \{/)
})
