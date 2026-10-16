import assert from 'node:assert/strict'
import test from 'node:test'
import { accountFromSearch, appBoardPath, sportFromSearch } from '../src/appSport.js'

test('the app reads a sport query and ignores anything else', () => {
  assert.equal(sportFromSearch('?sport=kbo'), 'kbo')
  assert.equal(sportFromSearch('?sport=nhl&x=1'), 'nhl')
  assert.equal(sportFromSearch('?sport=mlb'), null)
  assert.equal(sportFromSearch(''), null)
  assert.equal(appBoardPath('wnba'), '/?sport=wnba')
})

test('the account query opens the member account page', () => {
  assert.equal(accountFromSearch('?account=1'), true)
  assert.equal(accountFromSearch('?account=1&previewTier=weekly'), true)
  assert.equal(accountFromSearch('?account=0'), false)
  assert.equal(accountFromSearch(''), false)
})
