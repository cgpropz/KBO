import assert from 'node:assert/strict'
import test from 'node:test'
import { accountFromSearch, appBoardPath, pageEntryFromSearch, resultsFromSearch, slipLinkFromSearch, sportFromSearch, sportViewFromEntry } from '../src/appSport.js'

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

test('page and results queries open a cold view without replacing the slip link', () => {
  assert.deepEqual(pageEntryFromSearch('?sport=nfl&page=odds'), {
    sport: 'nfl', view: 'sharp', player: null, prop: null, drawer: false,
  })
  assert.deepEqual(pageEntryFromSearch('?sport=nhl&page=player&player=Macklin%20Celebrini&prop=Shots%20On%20Goal'), {
    sport: 'nhl', view: 'player', player: 'Macklin Celebrini', prop: 'Shots On Goal', drawer: false,
  })
  assert.equal(pageEntryFromSearch('?page=board'), null)
  assert.equal(pageEntryFromSearch('?page=results&sport=nfl'), null)
  assert.equal(resultsFromSearch('?results=1'), true)
  assert.equal(resultsFromSearch('?page=results'), true)
  assert.equal(resultsFromSearch('?sport=nfl'), false)
  assert.equal(sportViewFromEntry({ view: 'slip' }, { slipId: 'optimizer' }), 'optimizer')
  assert.equal(sportViewFromEntry({ view: 'board' }), 'dashboard')
  assert.equal(sportViewFromEntry({ view: 'sharp' }, { oddsId: 'board' }), 'board')
  assert.equal(slipLinkFromSearch('?s=NHL&d=1').view, 'slip')
})

test('the account query opens the member account page', () => {
  assert.equal(accountFromSearch('?account=1'), true)
  assert.equal(accountFromSearch('?account=1&previewTier=weekly'), true)
  assert.equal(accountFromSearch('?account=0'), false)
  assert.equal(accountFromSearch(''), false)
})
