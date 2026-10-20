// The Discord Only cards must not open Checkout Sessions on page load.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/DiscordOnlyPlans.jsx', import.meta.url), 'utf8')

test('no effect creates a session on mount or auth refresh', () => {
  assert.equal(/useEffect/.test(src), false)
  const calls = src.match(/requestDiscordCheckoutUrl\(/g) || []
  assert.equal(calls.length, 1)
  const startBody = src.slice(src.indexOf('async function start('), src.indexOf('return (\n'))
  assert.ok(startBody.includes('requestDiscordCheckoutUrl('), 'the only request is inside the click handler')
})

test('the click path checks age first, then reuses a recent URL, and ignores double clicks', () => {
  const startBody = src.slice(src.indexOf('async function start('), src.indexOf('return (\n'))
  assert.ok(startBody.indexOf('if (busy) return') < startBody.indexOf('requireAge()'))
  assert.ok(startBody.indexOf('requireAge()') < startBody.indexOf('requestDiscordCheckoutUrl('))
  assert.ok(startBody.indexOf('DISCORD_URL_REUSE_MS') < startBody.indexOf('requestDiscordCheckoutUrl('))
  assert.match(src, /export const DISCORD_URL_REUSE_MS = 60 \* 60 \* 1000/)
})

test('cards render buttons, not pre-made checkout links', () => {
  assert.equal(/href=\{/.test(src), false)
  assert.match(src, /onClick=\{\(\) => start\(plan\.plan\)\}/)
})

test('the click-URL cache is keyed by account, never shared across a logout/login', () => {
  assert.match(src, /const cacheKey = `\$\{user\?\.id \|\| 'guest'\}:\$\{plan\}`/)
  assert.match(src, /ready\.current\[cacheKey\] = \{ url, at: Date\.now\(\) \}/)
  assert.equal(/ready\.current\[plan\]/.test(src), false)
})
