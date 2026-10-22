import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nhlAvatarSources, usableHeadshotUrl } from '../src/nhl/nhlAvatar.js'

const PP = 'https://static.prizepicks.com/images/players/NHL/Fake_Skater_NHL_player_abc123.webp'
const MUG = 'https://assets.nhle.com/mugs/nhl/latest/8400001.png'

test('a PrizePicks headshot comes first, then the NHL mug', () => {
  const sources = nhlAvatarSources({ imageUrl: PP, playerId: '8400001' }, 42)
  assert.equal(sources.length, 2)
  assert.ok(sources[0].includes(encodeURIComponent(PP)))
  assert.ok(sources[1].includes(encodeURIComponent(MUG)))
})

test('a relative PrizePicks placeholder falls back to the NHL mug', () => {
  const sources = nhlAvatarSources({ imageUrl: '/assets/player-placeholder-DgCsV9RE.svg', playerId: '8400001' }, 42)
  assert.equal(sources.length, 1)
  assert.ok(sources[0].includes(encodeURIComponent(MUG)))
})

test('a placeholder with no player id leaves initials', () => {
  assert.deepEqual(nhlAvatarSources({ imageUrl: 'https://static.prizepicks.com/images/players/placeholder.png' }, 42), [])
  assert.deepEqual(nhlAvatarSources({ imageUrl: '' }, 42), [])
  assert.deepEqual(nhlAvatarSources(null, 42), [])
})

test('usableHeadshotUrl keeps only absolute https non-placeholder urls', () => {
  assert.equal(usableHeadshotUrl(PP), PP)
  assert.equal(usableHeadshotUrl('/assets/player-placeholder-DgCsV9RE.svg'), '')
  assert.equal(usableHeadshotUrl('http://example.com/a.png'), '')
  assert.equal(usableHeadshotUrl(undefined), '')
})

test('NHL board cards use the fallback avatar, not a bare imageUrl img', () => {
  for (const file of ['NhlPropLines.jsx', 'NhlProjections.jsx', 'NhlSharpOdds.jsx']) {
    const source = readFileSync(new URL(`../src/nhl/${file}`, import.meta.url), 'utf8')
    assert.ok(source.includes('<NhlAvatar item={item}'), file)
    assert.ok(!/item\.imageUrl\s*\?\s*<img/.test(source), file)
  }
  const avatar = readFileSync(new URL('../src/nhl/NhlAvatar.jsx', import.meta.url), 'utf8')
  assert.ok(avatar.includes('onError'))
})
