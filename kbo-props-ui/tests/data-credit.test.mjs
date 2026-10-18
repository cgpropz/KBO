// "Data: nflverse" credit: present in every static footer and in the React
// footers, pointing at https://github.com/nflverse.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderFooter } from '../scripts/seoShared.mjs'
import { DATA_CREDIT_URL } from '../src/dataCredit.js'

const root = new URL('..', import.meta.url).pathname
const CREDIT = /<p class="data-credit">Data: <a href="https:\/\/github\.com\/nflverse"[^>]*>nflverse<\/a><\/p>/

test('credit url is the nflverse org', () => {
  assert.equal(DATA_CREDIT_URL, 'https://github.com/nflverse')
})

test('static footer renderer ends with the credit', () => {
  const html = renderFooter()
  assert.match(html, CREDIT)
  assert.ok(html.indexOf('data-credit') > html.indexOf('ncpgambling.org'), 'credit is the last footer line')
})

test('every committed static page footer carries the credit', () => {
  const pages = [join(root, 'index.html')]
  for (const dir of ['public', 'public/guides']) {
    for (const name of readdirSync(join(root, dir))) {
      if (name.endsWith('.html')) pages.push(join(root, dir, name))
    }
  }
  for (const page of pages) {
    const html = readFileSync(page, 'utf8')
    if (!/<footer[\s>]/.test(html) || page.endsWith('test.html')) continue
    assert.match(html, CREDIT, `${page} is missing the nflverse credit`)
  }
})

test('React footers render the credit', () => {
  for (const file of ['src/SiteFooter.jsx', 'src/PublicLanding.jsx', 'src/MemberCommandCenter.jsx']) {
    assert.match(readFileSync(join(root, file), 'utf8'), /<DataCredit \/>/, `${file} footer is missing <DataCredit />`)
  }
})
