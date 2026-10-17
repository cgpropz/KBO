import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BOOT_LINES, BOOT_SLOW_MS, bootIsSlow, bootShowsLoader } from '../src/bootPhase.js'
import { parseCachedSession, readCachedSession, supabaseStorageKey } from '../src/supabaseClient.js'

test('the compact loader waits until about 1.5s', () => {
  assert.equal(BOOT_SLOW_MS, 1500)
  assert.equal(bootIsSlow(1499), false)
  assert.equal(bootIsSlow(1500), true)
  assert.equal(bootIsSlow(Number.NaN), false)
  assert.equal(bootShowsLoader(1500), true)
  assert.equal(bootShowsLoader(1500, { inset: true }), false)
  assert.equal(bootShowsLoader(200, { inset: false }), false)
})

test('the inline loader and the stylesheet share copy, color, and reduced motion', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/bootScreen.css', import.meta.url), 'utf8')
  for (const line of BOOT_LINES) {
    assert.equal(html.includes(line), true, line)
  }
  assert.equal(html.includes(css.trim()), true)
  assert.match(html, /animation: cg-boot-reveal 0s linear 1.5s forwards/)
  assert.match(html, /#cg-boot \.cg-boot-stage \{ display: flex; \}/)
  assert.match(css, /#050506/)
  assert.match(css, /#22c55e/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /\.cg-shimmer,\s*\.cg-bars span,\s*\.cg-boot-copy span \{ animation: none; \}/)
  assert.match(html, /window\.__cgBoot=0/)
  assert.match(html, /id="cg-boot"/)
  assert.equal((html.match(/class="cg-pick"/g) || []).length, 3)
  assert.equal((html.match(/class="cg-row"/g) || []).length, 5)
  assert.equal((html.match(/class="cg-bars"/g) || []).length, 1)
})

test('a cached supabase session reads the project storage key', () => {
  assert.equal(
    supabaseStorageKey('https://ocaqjkfdjqxszevtllew.supabase.co'),
    'sb-ocaqjkfdjqxszevtllew-auth-token',
  )
  assert.equal(supabaseStorageKey('not a url'), '')
  const parsed = parseCachedSession(JSON.stringify({
    access_token: 'tok',
    expires_at: 1_900_000_000,
    user: { id: 'u1', email: 'a@b.c' },
  }))
  assert.equal(parsed.user.id, 'u1')
  assert.equal(parsed.accessToken, 'tok')
  assert.equal(parsed.expiresAt, 1_900_000_000)
  assert.equal(parseCachedSession('nope'), null)
  assert.equal(parseCachedSession('{}'), null)
})

test('a member session stored under another project key still signs the board in', () => {
  const raw = JSON.stringify({
    access_token: 'tok',
    expires_at: 1_900_000_000,
    user: { id: 'u1', email: 'a@b.c' },
  })
  const storage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null },
    'sb-otherproject-auth-token': raw,
    'sb-otherproject-auth-token-code-verifier': 'ignore-me',
    'not-a-session': raw,
  }
  const parsed = readCachedSession(storage)
  assert.equal(parsed?.user?.id, 'u1')
  assert.equal(parsed?.accessToken, 'tok')
  assert.equal(readCachedSession({ getItem() { return null } }), null)
})
