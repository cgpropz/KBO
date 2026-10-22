import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('the hub account menu is not clipped by .hub-tools on narrow screens', () => {
  const css = read('src/mobile.css')
  const scroll = css.indexOf('overflow-x: auto;', css.indexOf('.hub-tools,'))
  const fix = css.search(/\.hub-tools \{\s*overflow: visible;\s*\}/)
  assert.ok(scroll > 0, 'shared nav overflow rule still lists .hub-tools')
  assert.ok(fix > scroll, '.hub-tools overflow: visible must follow the shared overflow-x rule')
})

test('the hub dropdown stacks above the sticky header and sport bar', () => {
  const css = read('src/MemberCommandCenter.css')
  const header = Number(css.match(/\.hub-top \{ top: 0; z-index: (\d+); \}/)[1])
  const bar = Number(css.match(/\.hub-sportbar \{ top: 60px; z-index: (\d+); \}/)[1])
  const menu = css.match(/\.hub-menu \{[^}]*z-index: (\d+);[^}]*\}/)
  assert.ok(menu, '.hub-menu sets a z-index')
  assert.ok(Number(menu[1]) > Math.max(header, bar))
})
