import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_MEMBER_SPORT,
  LEGACY_SPORT_STORAGE_KEY,
  MEMBER_SPORT_CHOICE_KEY,
  readMemberSportChoice,
  rememberMemberSport,
  resolveMemberSport,
  selectedHubSport,
  sportAfterNbaGate,
} from '../src/memberSport.js'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const hub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')

function memory(initial = {}) {
  const data = { ...initial }
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    },
    setItem(key, value) {
      data[key] = String(value)
    },
    dump() {
      return { ...data }
    },
  }
}

test('members default to NFL and ignore a legacy or implicit kbo value', () => {
  assert.equal(DEFAULT_MEMBER_SPORT, 'nfl')
  assert.equal(resolveMemberSport({ search: '', storage: memory() }), 'nfl')
  assert.equal(resolveMemberSport({ storage: null }), 'nfl')

  const legacy = memory({ [LEGACY_SPORT_STORAGE_KEY]: 'kbo' })
  assert.equal(resolveMemberSport({ search: '', storage: legacy }), 'nfl')
  assert.equal(legacy.dump()[MEMBER_SPORT_CHOICE_KEY], undefined)
  assert.equal(readMemberSportChoice(legacy), null)

  const legacyWnba = memory({ [LEGACY_SPORT_STORAGE_KEY]: 'wnba' })
  assert.equal(resolveMemberSport({ search: '?utm=email', storage: legacyWnba }), 'nfl')
})

test('an explicit choice under the new key is kept, and a bad value is not', () => {
  const saved = memory({
    [LEGACY_SPORT_STORAGE_KEY]: 'kbo',
    [MEMBER_SPORT_CHOICE_KEY]: 'wnba',
  })
  assert.equal(readMemberSportChoice(saved), 'wnba')
  assert.equal(resolveMemberSport({ search: '', storage: saved }), 'wnba')

  const invalid = memory({ [MEMBER_SPORT_CHOICE_KEY]: 'mlb' })
  assert.equal(readMemberSportChoice(invalid), null)
  assert.equal(resolveMemberSport({ storage: invalid }), 'nfl')
})

test('a sport query applies to this visit and does not get stored', () => {
  const saved = memory({ [MEMBER_SPORT_CHOICE_KEY]: 'wnba', [LEGACY_SPORT_STORAGE_KEY]: 'kbo' })
  assert.equal(resolveMemberSport({ search: '?sport=nhl', storage: saved }), 'nhl')
  assert.equal(resolveMemberSport({ search: '?sport=mlb', storage: saved }), 'wnba')
  assert.deepEqual(saved.dump(), {
    [MEMBER_SPORT_CHOICE_KEY]: 'wnba',
    [LEGACY_SPORT_STORAGE_KEY]: 'kbo',
  })
})

test('remembering a pick writes only the new key', () => {
  const storage = memory({ [LEGACY_SPORT_STORAGE_KEY]: 'kbo' })
  rememberMemberSport(storage, 'nfl')
  assert.equal(storage.dump()[MEMBER_SPORT_CHOICE_KEY], 'nfl')
  assert.equal(storage.dump()[LEGACY_SPORT_STORAGE_KEY], 'kbo')
  assert.equal(readMemberSportChoice(storage), 'nfl')

  rememberMemberSport(storage, 'not-a-sport')
  assert.equal(storage.dump()[MEMBER_SPORT_CHOICE_KEY], 'nfl')
  rememberMemberSport(null, 'kbo')
})

test('the hub features NFL unless the member picked, and a closed NBA falls back to NFL', () => {
  assert.equal(selectedHubSport(null), 'nfl')
  assert.equal(selectedHubSport(undefined), 'nfl')
  assert.equal(selectedHubSport(''), 'nfl')
  assert.equal(selectedHubSport('mlb'), 'nfl')
  assert.equal(selectedHubSport('kbo'), 'kbo')
  assert.equal(selectedHubSport('nba'), 'nba')

  assert.equal(sportAfterNbaGate('nba', false), 'nfl')
  assert.equal(sportAfterNbaGate('nba', true), 'nba')
  assert.equal(sportAfterNbaGate('wnba', false), 'wnba')
})

test('the member shell does not revive the old kbo default', () => {
  assert.equal(app.includes("localStorage.getItem('cg_sport')"), false)
  assert.equal(app.includes('SPORT_STORAGE_KEY'), false)
  assert.equal(app.includes('resolveMemberSport'), true)
  assert.equal(app.includes('rememberMemberSport'), true)
  assert.equal(app.includes('chooseSport'), true)
  assert.equal(app.includes("|| 'kbo'"), false)
  assert.equal(hub.includes('firstReady'), false)
  assert.equal(hub.includes('selectedHubSport'), true)
  assert.equal(hub.includes('rememberMemberSport'), true)
  assert.equal(hub.includes("? 'kbo'"), false)
})
