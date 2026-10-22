import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyPhoneBoardMedia } from '../phoneMediaPlugin.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('all five sport tabs fit a 320px phone row', () => {
  const css = read()
  const block = css.slice(css.indexOf('@media (max-width: 359px) {'))
  assert.ok(block.length > 0, 'narrow-phone sport tab rule exists')
  const gap = Number(block.match(/> \.sport-switcher \{\s*gap: (\d+)px;/)[1])
  const minWidth = Number(block.match(/\.sport-switcher button \{\s*min-width: (\d+)px;/)[1])
  // 320px viewport minus 16px page padding on each side.
  const row = 288
  const tabs = 5
  assert.ok(tabs * minWidth + (tabs - 1) * gap <= row, `${tabs} tabs need ${tabs * minWidth + (tabs - 1) * gap}px`)
})

test('the narrow rule follows the phone tab size and survives the build', () => {
  const css = read()
  const narrow = css.indexOf('@media (max-width: 359px) {')
  const tabs = css.indexOf('.sport-switcher button {', css.indexOf('@media (--phone-board)'))
  assert.ok(tabs >= 0 && narrow > tabs, 'must follow the default phone tab size')
  // Other tests read the phone block up to the next @media, so this rule is
  // a top-level block after it, not nested inside it.
  assert.ok(narrow > css.indexOf('@media', css.indexOf('@media (--phone-board)') + 1))
  assert.ok(applyPhoneBoardMedia(css).includes('@media (max-width: 359px)'))
})

function read() {
  return readFileSync(join(root, 'src/mobile.css'), 'utf8')
}
