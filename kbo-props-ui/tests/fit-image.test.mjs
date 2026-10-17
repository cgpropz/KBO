import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchableImageUrl, fitImage, isRemoteHeadshotOrLogo, manualPlayerPng, parseImageQuery, snapWidth } from '../src/fitImage.js'

test('local team logos become the small webp file', () => {
  assert.equal(fitImage('/team-logos/kt.svg', 22), '/team-logos/kt.webp')
  assert.equal(fitImage('team-logos/kia.png', 26), 'team-logos/kia.webp')
  assert.equal(fitImage('/team-logos/doosan.webp', 40), '/team-logos/doosan.webp')
})

test('PrizePicks headshots resize to a small webp through the image proxy', () => {
  const headshot = 'https://static.prizepicks.com/images/players/NFL/Xavier_Hutchinson_NFL_player_abcDEF123.webp'
  assert.equal(isRemoteHeadshotOrLogo(headshot), true)
  assert.equal(fitImage(headshot, 32), `/api/img?src=${encodeURIComponent(headshot)}&w=64`)
  assert.equal(fitImage(headshot, 48), `/api/img?src=${encodeURIComponent(headshot)}&w=96`)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/players/NHL/Evgeni_Malkin__NHL_player_abc.webp'), true)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/players/NHL/Jean-Gabriel_Pageau_NHL_player_abc.webp'), true)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/players/NFL/../../secret.webp'), false)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/other/a.webp'), false)
})

test('espn and nhl headshots go through the same-origin resizer', () => {
  const headshot = 'https://a.espncdn.com/i/headshots/nfl/players/full/15818.png'
  const logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png'
  assert.equal(snapWidth(40), 80)
  assert.equal(snapWidth(72), 128)
  assert.equal(fitImage(headshot, 42), `/api/img?src=${encodeURIComponent(headshot)}&w=80`)
  assert.equal(fitImage(logo, 22), `/api/img?src=${encodeURIComponent(logo)}&w=48`)
  assert.equal(isRemoteHeadshotOrLogo('https://assets.nhle.com/mugs/nhl/edm/8478402.png'), true)
})

test('nfl and wnba board headshots go through the resizer at display size', () => {
  const nfl = 'https://static.www.nfl.com/image/private/f_auto,q_auto/league/abc123'
  const thumb = 'https://static.www.nfl.com/image/private/f_auto,q_auto,c_thumb,w_200/league/abc123'
  const sized = 'https://static.www.nfl.com/image/upload/f_auto,q_auto,w_80/league/abc123'
  const wnba = 'https://cdn.wnba.com/headshots/wnba/latest/1040x760/1628273.png'
  assert.equal(fetchableImageUrl(nfl), thumb)
  assert.equal(fetchableImageUrl(sized), sized)
  assert.equal(fetchableImageUrl(thumb), thumb)
  assert.equal(fitImage(nfl, 42), `/api/img?src=${encodeURIComponent(thumb)}&w=80`)
  assert.equal(fitImage(thumb, 42), `/api/img?src=${encodeURIComponent(thumb)}&w=80`)
  assert.equal(fitImage(wnba, 30), `/api/img?src=${encodeURIComponent(wnba)}&w=64`)
  assert.equal(isRemoteHeadshotOrLogo(`${nfl}?x=1`), false)
  assert.equal(isRemoteHeadshotOrLogo('https://static.www.nfl.com/image/private/../../secret'), false)
  assert.equal(isRemoteHeadshotOrLogo('https://cdn.wnba.com/headshots/wnba/latest/1040x760/../1.png'), false)
  assert.equal(fitImage(`${nfl}?x=1`, 42), `${nfl}?x=1`)
})

test('prizepicks manual player pngs are allowed with spaces or percent encoding', () => {
  const png = 'https://static.prizepicks.com/images/manual/Kim Do-yeong.png'
  const encoded = 'https://static.prizepicks.com/images/manual/Kim%20Do-yeong.png'
  assert.equal(manualPlayerPng(png), png)
  assert.equal(manualPlayerPng(encoded), encoded)
  assert.equal(isRemoteHeadshotOrLogo(png), true)
  assert.equal(isRemoteHeadshotOrLogo(encoded), true)
  assert.equal(fetchableImageUrl(png), encoded)
  assert.equal(fitImage(png, 40), `/api/img?src=${encodeURIComponent(encoded)}&w=80`)
  assert.equal(parseImageQuery(png, 80)?.src, png)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/manual/../secret.png'), false)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/manual/Baseball-Asset.webp'), false)
  assert.equal(isRemoteHeadshotOrLogo('https://static.prizepicks.com/images/teams/nfl/NFL_team_x/19.webp'), false)
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
  const nfl = 'https://static.www.nfl.com/image/private/f_auto,q_auto/league/abc123'
  assert.equal(parseImageQuery(nfl, 160)?.width, 128)
  assert.equal(parseImageQuery(nfl, '160')?.width, 128)
  assert.match(fitImage(nfl, 72), /&w=128$/)
})
