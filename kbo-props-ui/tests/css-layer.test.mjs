import assert from 'node:assert/strict'
import test from 'node:test'
import { wrapCssInComponentsLayer } from '../cssLayerPlugin.js'

test('project css is wrapped in the components layer', () => {
  const css = '.nfl-lines-table { min-width: 900px; }\n'
  const out = wrapCssInComponentsLayer(css, '/src/nfl/nfl.css')
  assert.match(out, /^@layer components \{/)
  assert.match(out, /min-width: 900px/)
})

test('font imports stay above the layer', () => {
  const css = "@import url('https://fonts.example/css2?family=Inter:wght@500;600;700&display=swap');\n.nhl { color: white; }\n"
  const out = wrapCssInComponentsLayer(css, '/src/nhl/nhl.css')
  assert.match(out, /^@import url\('https:\/\/fonts\.example\/css2\?family=Inter:wght@500;600;700&display=swap'\);\n@layer components \{/)
  assert.match(out, /\.nhl \{ color: white; \}/)
  assert.doesNotMatch(out, /@layer components \{[\s\S]*@import/)
})

test('the shared mobile sheet stays unlayered', () => {
  const css = '@media (max-width: 767px) { .cg-menu-btn { display: flex; } }\n'
  assert.equal(wrapCssInComponentsLayer(css, '/src/mobile.css'), null)
  assert.equal(wrapCssInComponentsLayer(css, '/src/mobile.css?direct'), null)
})

test('node_modules css is left alone', () => {
  assert.equal(wrapCssInComponentsLayer('.x{}', '/node_modules/lib/index.css'), null)
})

test('a second pass does not nest the layer', () => {
  const once = wrapCssInComponentsLayer('.card { color: red; }\n', '/src/App.css')
  const twice = wrapCssInComponentsLayer(once, '/src/App.css')
  assert.equal(twice.match(/@layer components/g).length, 1)
})
