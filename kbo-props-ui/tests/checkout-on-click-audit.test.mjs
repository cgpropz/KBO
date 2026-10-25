// Checkout Sessions are created only after an explicit Buy click.
// Page load, pricing mount, and prefetch must not call the session endpoints.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))
const CALL = /prefetchWeeklyCheckoutUrl|openWeeklyCheckoutUrl\(|requestWeeklyCheckoutUrl\(|requestOfferCheckoutUrl\(|requestDiscordCheckoutUrl\(|\/api\/weekly-checkout|\/api\/discord-checkout|\/api\/checkout\/(?:lifetime|founders)/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(js|jsx|mjs|html)$/.test(name)) out.push(path)
  }
  return out
}

function effectSources(src) {
  const chunks = []
  let from = 0
  while (from < src.length) {
    const start = src.indexOf('useEffect(', from)
    if (start < 0) break
    let i = start + 'useEffect('.length
    let depth = 1
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    chunks.push(src.slice(start, i))
    from = i
  }
  return chunks
}

test('UI checkout calls stay in the click modules and out of effects', () => {
  const files = walk(join(uiRoot, 'src'))
  const callers = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    assert.equal(src.includes('prefetchWeeklyCheckoutUrl'), false, file)
    for (const effect of effectSources(src)) {
      assert.equal(CALL.test(effect), false, file)
    }
    const marker = `${join('kbo-props-ui', 'src')}`
    if (CALL.test(src)) callers.push(file.slice(file.indexOf(marker) + 'kbo-props-ui'.length))
  }
  callers.sort()
  assert.deepEqual(callers, [
    '/src/DiscordOnlyPlans.jsx',
    '/src/PublicLanding.jsx',
    '/src/SubscriptionPage.jsx',
    '/src/tracking.js',
  ])
})

test('static pages do not request a Checkout Session', () => {
  const pages = [join(uiRoot, 'index.html'), ...walk(join(uiRoot, 'public'))]
  for (const file of pages) {
    const src = readFileSync(file, 'utf8')
    assert.equal(CALL.test(src), false, file)
  }
})
