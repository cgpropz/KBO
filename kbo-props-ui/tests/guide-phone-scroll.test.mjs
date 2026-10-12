import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listGuides } from '../scripts/markdownGuide.mjs'

test('guide tables scroll inside the page instead of widening it', () => {
  const start = listGuides().find((guide) => guide.path === '/guides/start-here')
  assert.ok(start, 'start-here guide')
  assert.match(start.html, /class="table-scroll"/)
  assert.match(start.html, /html \{ overflow-x: clip; \}/)
  assert.match(start.html, /width: min\(980px, 100%\)/)
  assert.equal(start.html.includes('<table>'), true)
  assert.equal(/<table>/.test(start.html.replace(/<div class="table-scroll">\s*<table>/g, '')), false)
})
