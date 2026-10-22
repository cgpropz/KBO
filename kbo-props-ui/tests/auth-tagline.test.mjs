import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the sign-in tagline names every live sport', () => {
  const src = readFileSync(join(root, 'src/AuthPage.jsx'), 'utf8')
  const tagline = src.match(/<p className="auth-tagline">([^<]*)<\/p>/)
  assert.ok(tagline, 'auth tagline is present')
  for (const sport of ['KBO', 'WNBA', 'NFL', 'NBA', 'NHL']) {
    assert.match(tagline[1], new RegExp(`\\b${sport}\\b`))
  }
})
