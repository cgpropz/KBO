import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitImage, isRemoteHeadshotOrLogo, parseImageQuery, snapWidth } from '../src/fitImage.js'

test('local team logos become the small webp file', () => {
  assert.equal(fitImage('/team-logos/kt.svg', 22), '/team-logos/kt.webp')
  assert.equal(fitImage('team-logos/kia.png', 26), 'team-logos/kia.webp')
  assert.equal(fitImage('/team-logos/doosan.webp', 40), '/team-logos/doosan.webp')
})

test('espn and nhl headshots go through the same-origin resizer', () => {
  const headshot = 'https://a.espncdn.com/i/headshots/nfl/players/full/15818.png'
  const logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png'
  assert.equal(snapWidth(40), 80)
  assert.equal(snapWidth(72), 128)
  assert.equal(fitImage(headshot, 42), `/api/img?src=${encodeURIComponent(headshot)}&w=80`)
  assert.equal(fitImage(logo, 22), `/api/img?src=${encodeURIComponent(logo)}&w=48`)
  assert.equal(isRemoteHeadshotOrLogo('https://assets.nhle.com/mugs/nhl/edm/8478402.png'), true)
  const prizepicks = 'https://static.prizepicks.com/images/players/NHL/Adam_Fox_NHL_player_abc.webp'
  const wnba = 'https://cdn.wnba.com/headshots/wnba/latest/1040x760/1628277.png'
  assert.equal(fitImage(prizepicks, 44), `/api/img?src=${encodeURIComponent(prizepicks)}&w=80`)
  assert.equal(fitImage(wnba, 44), `/api/img?src=${encodeURIComponent(wnba)}&w=80`)
})

test('the image route refuses anything that is not a public headshot or logo', () => {
  const blocked = [
    'https://example.com/i/headshots/nfl/players/full/1.png',
    'https://a.espncdn.com/i/headshots/nfl/players/full/../../secret.png',
    'https://a.espncdn.com/i/headshots/nfl/players/full/1.png?x=1',
    'https://ocaqjkfdjqxszevtllew.supabase.co/storage/v1/object/public/paid/board.png',
    '/data/prizepicks_props.json',
    'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png\nhttps://evil.test/a.png',
  ]
  for (const url of blocked) {
    assert.equal(isRemoteHeadshotOrLogo(url), false, url)
    assert.equal(parseImageQuery(url, 80), null, url)
    assert.equal(fitImage(url, 40), url, url)
  }
  assert.equal(parseImageQuery('https://a.espncdn.com/i/teamlogos/nba/500/ny.png', 80)?.width, 80)
  assert.equal(parseImageQuery('https://a.espncdn.com/i/teamlogos/nba/500/ny.png', 81), null)
})
