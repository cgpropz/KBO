// Discord-only must not unlock site data. Existing tiers stay aligned.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sportAccess as serverAccess, shapeForTier } from '../api/_dataAccess.js'
import { hasAnyPaidAccess, sportAccess as clientAccess } from '../src/entitlements.js'

const TIERS = ['free', 'discord', 'kbo', 'wnba', 'combined', 'weekly', 'monthly', 'season', 'pro', 'all', 'owner']

test('client and server sport access stay in sync, and discord unlocks nothing', () => {
  for (const tier of TIERS) {
    assert.deepEqual(serverAccess(tier), clientAccess(tier), tier)
  }
  assert.deepEqual(clientAccess('discord'), { kbo: false, wnba: false, nfl: false })
  assert.equal(hasAnyPaidAccess('discord'), false)
  assert.equal(hasAnyPaidAccess('combined'), true)
  assert.equal(hasAnyPaidAccess('kbo'), true)
  assert.equal(hasAnyPaidAccess('free'), false)
})

test('a discord tier receives the free preview, not the paid board', () => {
  const payload = { cards: [{ id: 'a', props: [{ cg_projection: 1 }, { cg_projection: 9 }] }] }
  const discord = shapeForTier('prizepicks_props', payload, 'discord')
  const free = shapeForTier('prizepicks_props', payload, 'free')
  const paid = shapeForTier('prizepicks_props', payload, 'combined')
  assert.equal(discord.preview, true)
  assert.deepEqual(discord.data, free.data)
  assert.equal(paid.preview, false)
  assert.equal(shapeForTier('nfl_projections', [{ projection: 1, line: 1 }], 'discord').preview, true)
  assert.equal(shapeForTier('nfl_projections', [{ projection: 1, line: 1 }], 'weekly').preview, false)
})
