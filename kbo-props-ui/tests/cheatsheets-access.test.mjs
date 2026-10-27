import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { NBA_OWNER_EMAIL } from '../src/entitlements.js'
import {
  cheatsheetsGate,
  cheatsheetsHref,
  layoutFromSearch,
  leagueFromSearch,
  sportChrome,
  stripCheatsheetsSearch,
} from '../src/cheatsheets/access.js'
import { chartPct, heatColor, moneyline, signed1 } from '../src/cheatsheets/gameProjFormat.js'

const example = JSON.parse(readFileSync(new URL('../src/cheatsheets/gameProjExample.json', import.meta.url), 'utf8'))
const proj = readFileSync(new URL('../src/cheatsheets/GameProj.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('only the admin email can open cheatsheets', () => {
  assert.equal(NBA_OWNER_EMAIL, 'cgpropz@gmail.com')
  const admin = { email: 'cgpropz@gmail.com' }
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: admin }), 'allow')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: { email: ' CGPROPZ@gmail.com ' } }), 'allow')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: { email: 'monthly@preview.local' } }), 'deny')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: { email: 'fan@example.com' } }), 'deny')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: null, sessionPending: true }), 'wait')
  assert.equal(cheatsheetsGate({ search: '?cheatsheets=1', user: null, sessionPending: false }), 'deny')
  assert.equal(cheatsheetsGate({ search: '?sport=nfl&page=markets', user: admin }), null)
  assert.equal(stripCheatsheetsSearch('?cheatsheets=1&league=nba&gp=pro&previewTier=monthly'), '?previewTier=monthly')
  assert.equal(cheatsheetsHref('?sport=nfl&previewTier=owner'), '/?cheatsheets=1&previewTier=owner')
})

test('every sport tab uses the EXAMPLE DAL@PHI mock, not a live feed', () => {
  assert.equal(example.label, 'EXAMPLE DATA — not live board')
  assert.equal(example.game.away.abbr, 'DAL')
  assert.equal(example.game.home.abbr, 'PHI')
  assert.equal(example.cg.total, 50.5)
  assert.equal(sportChrome('nfl', example).week, 'NFL · Week 9')
  assert.equal(sportChrome('nba', example).week, 'NBA · EXAMPLE')
  assert.equal(sportChrome('nhl', example).name, 'NHL')
  assert.equal(sportChrome('wnba', example).week, 'WNBA · EXAMPLE')
  assert.equal(sportChrome('kbo', example).week, 'KBO · EXAMPLE')
  assert.equal(leagueFromSearch('?league=nba'), 'nba')
  assert.equal(leagueFromSearch('?league=nope'), 'nfl')
  assert.equal(layoutFromSearch('?gp=pro'), 'pro')
  assert.equal(layoutFromSearch(''), 'standard')
  assert.match(proj, /gameProjExample\.json/)
  assert.match(proj, /LayoutToggle/)
  assert.doesNotMatch(proj, /fetch\(|\/api\/|nflData|game_markets/)
  assert.match(app, /cheatsheetGate/)
  assert.match(app, /canSeeCheatsheets\(user\)/)
  assert.match(app, /cheatsheets\/Cheatsheets/)
})

test('example chart and heat colors match the locked draft', () => {
  assert.equal(signed1(3), '+3.0')
  assert.equal(signed1(-5.7), '-5.7')
  assert.equal(moneyline(140), '+140')
  assert.equal(moneyline(-165), '-165')
  assert.equal(chartPct(41), 29.7)
  assert.equal(chartPct(47.5), 47.3)
  assert.equal(heatColor(71), '#4ade80')
  assert.equal(heatColor(64), '#86efac')
  assert.equal(heatColor(48), '#d4d4d8')
  assert.equal(heatColor(42), '#fca5a5')
  assert.equal(heatColor(33), '#f87171')
})
