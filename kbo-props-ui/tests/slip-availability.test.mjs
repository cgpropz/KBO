import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calendarDay,
  kboBoardIsOpen,
  kboEmptyState,
  keepSlipRow,
  playsOnDay,
  wnbaEmptyState,
} from '../src/slipAvailability.js'

const NOW = new Date('2026-10-16T22:00:00Z')

test('started, locked, and scratched rows stay out of the slip', () => {
  assert.equal(keepSlipRow({ player: 'A', prop: 'Shots On Goal', line: 2.5, started: true }, { now: NOW }), false)
  assert.equal(keepSlipRow({ player: 'A', prop: 'Shots On Goal', line: 2.5, locked: true }, { now: NOW }), false)
  assert.equal(keepSlipRow({ player: 'A', prop: 'Shots On Goal', line: 2.5, status: 'scratched' }, { now: NOW }), false)
  assert.equal(keepSlipRow({ player: 'A', prop: 'Shots On Goal', line: 2.5, injury: 'OUT' }, { now: NOW }), false)
  assert.equal(keepSlipRow({ player: 'A', prop: 'Shots On Goal', line: 2.5, start_time: '2026-10-16T16:00:00Z' }, { now: NOW }), false)
  assert.equal(keepSlipRow({ player: 'A', prop: 'Shots On Goal', line: 2.5, start_time: '2026-10-17T00:00:00Z' }, { now: NOW }), true)
})

test('NHL points overs under 0.69 are hidden and unders stay', () => {
  assert.equal(keepSlipRow({ prop: 'Points', projection: 0.5, line: 0.5 }, { pointsGate: true }), false)
  assert.equal(keepSlipRow({ prop: 'Points', projection: 0.68, line: 0.5 }, { pointsGate: true }), false)
  assert.equal(keepSlipRow({ prop: 'Points', projection: 0.69, line: 0.5 }, { pointsGate: true }), true)
  assert.equal(keepSlipRow({ prop: 'Points', projection: 0.4, line: 1.5 }, { pointsGate: true }), true)
  assert.equal(keepSlipRow({ prop: 'Shots On Goal', projection: 0.4, line: 0.5 }, { pointsGate: true }), true)
})

test('KBO empty board names the next game and WNBA hides a dead slate', () => {
  assert.equal(kboBoardIsOpen({ cards: [] }), false)
  assert.equal(kboBoardIsOpen({ cards: [{ name: 'A' }] }), true)
  const empty = kboEmptyState({ away: 'LG', home: 'Kia', label_et: 'Sat, Oct 17, 1:00 AM ET' })
  assert.equal(empty.title, 'No upcoming props')
  assert.match(empty.detail, /LG @ Kia/)
  assert.match(empty.detail, /1:00 AM ET/)
  assert.equal(wnbaEmptyState().title, 'No games today')
  assert.equal(playsOnDay([{ ppAllProps: [{ gameDate: '2026-10-16' }] }], '2026-10-16'), true)
  assert.equal(playsOnDay([{ ppAllProps: [{ gameDate: '2026-09-01' }] }], '2026-10-16'), false)
  assert.equal(playsOnDay([{ name: 'A' }], '2026-10-16'), false)
  assert.equal(calendarDay('2026-10-16T23:30:00Z', 'America/New_York'), '2026-10-16')
})
