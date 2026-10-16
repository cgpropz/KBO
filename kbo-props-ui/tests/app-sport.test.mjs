import assert from 'node:assert/strict'
import test from 'node:test'
import { accountFromSearch, appBoardPath, slipLinkFromSearch, sportFromSearch } from '../src/appSport.js'

test('the app reads a sport query and ignores anything else', () => {
  assert.equal(sportFromSearch('?sport=kbo'), 'kbo')
  assert.equal(sportFromSearch('?sport=nhl&x=1'), 'nhl')
  assert.equal(sportFromSearch('?sport=mlb'), null)
  assert.equal(sportFromSearch(''), null)
  assert.equal(appBoardPath('wnba'), '/?sport=wnba')
})

test('?s= opens the slip and d=1 opens the drawer', () => {
  assert.equal(sportFromSearch('?s=NHL'), 'nhl')
  assert.equal(sportFromSearch('?s=mlb'), null)
  assert.deepEqual(slipLinkFromSearch('?s=NHL&d=1'), { sport: 'nhl', view: 'slip', drawer: true })
  assert.deepEqual(slipLinkFromSearch('?s=nfl'), { sport: 'nfl', view: 'slip', drawer: false })
  assert.equal(slipLinkFromSearch('?sport=nhl&d=1'), null)
})

test('the account query opens the member account page', () => {
  assert.equal(accountFromSearch('?account=1'), true)
  assert.equal(accountFromSearch('?account=1&previewTier=weekly'), true)
  assert.equal(accountFromSearch('?account=0'), false)
  assert.equal(accountFromSearch(''), false)
})
