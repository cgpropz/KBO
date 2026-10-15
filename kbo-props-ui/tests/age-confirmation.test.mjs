import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AGE_CONFIRMATION_KEY,
  isAgeConfirmed,
  isStripeCheckoutHref,
  readAgeConfirmation,
  rememberAgeConfirmation,
} from '../src/ageConfirmation.js'

function memoryStorage() {
  const data = new Map()
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(key, String(value)) },
  }
}

test('age confirmation is remembered and can be read back', () => {
  const storage = memoryStorage()
  assert.equal(isAgeConfirmed(storage), false)
  const confirmedAt = rememberAgeConfirmation(storage, new Date('2026-10-15T12:00:00.000Z'))
  assert.equal(confirmedAt, '2026-10-15T12:00:00.000Z')
  assert.equal(storage.getItem(AGE_CONFIRMATION_KEY), confirmedAt)
  assert.deepEqual(readAgeConfirmation(storage), { confirmedAt })
  assert.equal(isAgeConfirmed(storage), true)
})

test('only Stripe checkout hosts count as checkout links', () => {
  assert.equal(isStripeCheckoutHref('https://buy.stripe.com/00wcN7gkD7Ui8ng6z65Ne08'), true)
  assert.equal(isStripeCheckoutHref('https://checkout.stripe.com/c/pay/cs_live_abc'), true)
  assert.equal(isStripeCheckoutHref('https://buy.stripe.com/00wcN7gkD7Ui8ng6z65Ne08?prefilled_email=a@b.com'), true)
  assert.equal(isStripeCheckoutHref('https://www.cgpropz.com/pricing'), false)
  assert.equal(isStripeCheckoutHref('https://discord.gg/w3wgbCcxDZ'), false)
  assert.equal(isStripeCheckoutHref('not a url'), false)
})
