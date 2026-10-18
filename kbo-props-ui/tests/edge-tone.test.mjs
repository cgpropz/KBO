import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { edgeTone, isZeroEdge } from '../src/edgeTone.js'

test('an edge that shows as zero is grey, not red', () => {
  for (const v of [0, -0, '0', 0.004, -0.004]) assert.equal(edgeTone(v), 'edge-zero', String(v))
  assert.equal(edgeTone(0.04, 1), 'edge-zero')
  assert.equal(edgeTone(0.01), 'edge-pos')
  assert.equal(edgeTone(-0.01), 'edge-neg')
  assert.equal(isZeroEdge(null), false)
  assert.equal(isZeroEdge(undefined), false)
  assert.equal(isZeroEdge('x'), false)
})

test('slip views use the grey zero tone and define it in CSS', () => {
  const so = fs.readFileSync(new URL('../src/SlipOptimizer.jsx', import.meta.url), 'utf8')
  assert.equal((so.match(/isZeroEdge\(/g) || []).length, 6)
  const k = fs.readFileSync(new URL('../src/StrikeoutProjections.jsx', import.meta.url), 'utf8')
  assert.match(k, /isZeroEdge\(pk\.edge, 1\) \? 'edge-zero'/)
  for (const css of ['SlipOptimizer.css', 'StrikeoutProjections.css']) {
    assert.match(fs.readFileSync(new URL(`../src/${css}`, import.meta.url), 'utf8'), /\.edge-zero \{ color: #94a3b8; \}/)
  }
})
