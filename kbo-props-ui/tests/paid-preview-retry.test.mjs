import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DATASETS } from '../api/_dataAccess.js'
import { datasetSport } from '../src/entitlements.js'
import { memberPreviewIsDowngrade } from '../src/memberPreview.js'

const apiSource = readFileSync(new URL('../src/apiData.js', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

function session(id = 'user-1') {
  return { user: { id } }
}

function tierCache(value) {
  const raw = value == null ? 'null' : JSON.stringify(value)
  return { getItem() { return raw } }
}

const preview = { preview: true, data: [{ player: 'A' }] }
const full = { preview: false, data: [{ player: 'A' }, { player: 'B' }] }

test('client dataset sports match the server gate', () => {
  for (const [ds, spec] of Object.entries(DATASETS)) {
    assert.equal(datasetSport(ds), spec.sport, ds)
  }
})

test('a matching all-access tier retries an NFL preview', () => {
  assert.equal(memberPreviewIsDowngrade('nfl_projections', preview, {
    session: session(),
    tierCache: tierCache({ userId: 'user-1', tier: 'combined' }),
  }), true)
})

test('a KBO tier keeps the NFL, NHL, and WNBA preview', () => {
  for (const ds of ['nfl_projections', 'nhl_projections', 'wnba_projections_standard']) {
    assert.equal(memberPreviewIsDowngrade(ds, preview, {
      session: session(),
      tierCache: tierCache({ userId: 'user-1', tier: 'kbo' }),
    }), false, ds)
  }
  assert.equal(memberPreviewIsDowngrade('strikeout_projections', preview, {
    session: session(),
    tierCache: tierCache({ userId: 'user-1', tier: 'kbo' }),
  }), true)
})

test('an admin tier that unlocks nothing keeps the preview', () => {
  assert.equal(memberPreviewIsDowngrade('nhl_projections', preview, {
    session: session(),
    tierCache: tierCache({ userId: 'user-1', tier: 'admin' }),
  }), false)
})

test('a cached tier for a different session is not a downgrade', () => {
  assert.equal(memberPreviewIsDowngrade('nfl_projections', preview, {
    session: session('user-1'),
    tierCache: tierCache({ userId: 'user-2', tier: 'owner' }),
  }), false)
})

test('a full board is not retried', () => {
  assert.equal(memberPreviewIsDowngrade('nfl_projections', full, {
    session: session(),
    tierCache: tierCache({ userId: 'user-1', tier: 'combined' }),
  }), false)
})

test('a second preview is rendered instead of the raw downgrade error', () => {
  assert.equal(apiSource.includes('Paid board'), false)
  assert.equal(apiSource.includes('returned as the free preview'), false)
  assert.match(apiSource, /memberPreviewIsDowngrade/)
  assert.match(apiSource, /The second answer is what we render, including a preview/)
  assert.match(apiSource, /refreshFullBoard/)
  assert.match(appSource, /Refreshing full board/)
})
