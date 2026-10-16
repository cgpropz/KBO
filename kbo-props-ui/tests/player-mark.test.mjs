import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { avatarSize, inkOn, landingHeadshotUrl, landingTeamFill, playerInitials } from '../src/playerMark.js'
import { LANDING_HEADSHOTS_ENABLED } from '../src/headshotFlag.js'

const mark = readFileSync(new URL('../src/PlayerMark.jsx', import.meta.url), 'utf8')
const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/PublicLanding.css', import.meta.url), 'utf8')

test('initials come from the first two name parts', () => {
  assert.equal(playerInitials('Xavier Hutchinson'), 'XH')
  assert.equal(playerInitials('Kim Do-yeong'), 'KD')
  assert.equal(playerInitials('A'), 'A')
  assert.equal(playerInitials(''), '')
})

test('landing fills are team colors and never image urls', () => {
  const samples = [
    ['nfl', 'HOU', '#03202F'],
    ['wnba', 'LVA', '#C9A84C'],
    ['wnba', 'gs', '#FFC72C'],
    ['kbo', 'KIA', '#ff4444'],
    ['nhl', 'EDM', '#041E42'],
    ['nhl', 'tb', '#002868'],
  ]
  for (const [sport, team, color] of samples) {
    assert.equal(landingTeamFill(sport, team), color)
    assert.match(landingTeamFill(sport, team), /^#[0-9A-Fa-f]{6}$/)
  }
  assert.match(landingTeamFill('nhl', 'NO-SUCH'), /^#[0-9A-Fa-f]{6}$/)
  assert.equal(landingTeamFill('nfl', ''), '#3f3f46')
})

test('ink stays dark on a light jersey and light on a dark one', () => {
  assert.equal(inkOn('#FFB81C'), '#111214')
  assert.equal(inkOn('#03202F'), '#fff')
  assert.equal(avatarSize(28), 28)
  assert.equal(avatarSize(0), 32)
})

test('only a PrizePicks headshot is shown, and the flag turns it off', () => {
  const pp = 'https://static.prizepicks.com/images/players/NHL/Connor_McDavid_NHL_player_ZsBSAldX3sB96ZfnwbmGuKv.webp'
  assert.equal(LANDING_HEADSHOTS_ENABLED, true)
  const malkin = 'https://static.prizepicks.com/images/players/NHL/Evgeni_Malkin__NHL_player_AQet8bcpjOIi2StmmR8O8Cbn.webp'
  const hyphen = 'https://static.prizepicks.com/images/players/NHL/Jean-Gabriel_Pageau_NHL_player_abc.webp'
  assert.equal(landingHeadshotUrl({ ppImageUrl: pp }), pp)
  assert.equal(landingHeadshotUrl({ imageUrl: malkin }), malkin)
  assert.equal(landingHeadshotUrl({ ppImageUrl: hyphen }), hyphen)
  assert.equal(landingHeadshotUrl({ imageUrl: 'https://static.www.nfl.com/image/upload/league/abc' }), '')
  assert.equal(landingHeadshotUrl({ image: 'https://cdn.wnba.com/headshots/wnba/latest/1040x760/1.png' }), '')
  assert.equal(landingHeadshotUrl({ ppImageUrl: pp }, false), '')
  assert.equal(landingHeadshotUrl({ ppImageUrl: 'https://static.prizepicks.com/images/players/../secret.webp' }), '')
})

test('landing photos are lazy, sized, and kept out of the hero', () => {
  assert.match(mark, /loading="lazy"/)
  assert.match(mark, /width=\{px\}/)
  assert.match(mark, /height=\{px\}/)
  assert.match(mark, /decoding="async"/)
  assert.match(mark, /onError/)
  assert.match(landing, /image=\{row\.ppImageUrl\}/)
  assert.match(landing, /photo=\{false\}/)
  assert.equal(/espncdn|nhle\.com|mykbostats|teamlogos/i.test(landing), false)
  assert.equal(/\.pl-avatar\s*\{\s*display:\s*none/.test(css), false)
  assert.match(css, /width:\s*var\(--pl-avatar,\s*32px\)/)
  assert.match(css, /height:\s*var\(--pl-avatar,\s*32px\)/)
  assert.match(css, /img\.pl-avatar[\s\S]*object-fit:\s*cover/)
})
