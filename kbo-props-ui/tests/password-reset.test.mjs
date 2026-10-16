import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { AUTH_RATE_LIMIT_MESSAGE, authErrorMessage } from '../src/authErrors.js'
import { noActivePlanNotice } from '../src/manageSubscriptionCopy.js'
import {
  applyNewPassword,
  isPasswordRecoveryLocation,
  recoveryRedirectUrl,
} from '../src/passwordRecovery.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('supabase rate limits become the friendly reset message', () => {
  assert.equal(
    authErrorMessage({ message: 'email rate limit exceeded', status: 429 }),
    AUTH_RATE_LIMIT_MESSAGE,
  )
  assert.equal(authErrorMessage({ message: 'Email rate limit exceeded' }), AUTH_RATE_LIMIT_MESSAGE)
  assert.equal(authErrorMessage({ status: 429, message: 'For security purposes, you can only request this after 60 seconds.' }), AUTH_RATE_LIMIT_MESSAGE)
  assert.equal(authErrorMessage({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }), AUTH_RATE_LIMIT_MESSAGE)
  assert.equal(authErrorMessage('email rate limit exceeded'), AUTH_RATE_LIMIT_MESSAGE)
  assert.equal(AUTH_RATE_LIMIT_MESSAGE, 'Too many requests, try again in a few minutes or DM @Cgpropz')
  assert.equal(authErrorMessage({ message: 'Invalid login credentials', status: 400 }), 'Invalid login credentials')
})

test('the recovery redirect lands on the set-new-password query', () => {
  assert.equal(recoveryRedirectUrl('https://www.cgpropz.com'), 'https://www.cgpropz.com/?recovery=1')
  assert.equal(recoveryRedirectUrl('https://www.cgpropz.com/'), 'https://www.cgpropz.com/?recovery=1')
  assert.equal(recoveryRedirectUrl('http://localhost:5173'), 'http://localhost:5173/?recovery=1')
  assert.equal(isPasswordRecoveryLocation('?recovery=1'), true)
  assert.equal(isPasswordRecoveryLocation('?recovery=1&previewTier=weekly'), true)
  assert.equal(isPasswordRecoveryLocation('', '#access_token=abc&type=recovery'), true)
  assert.equal(isPasswordRecoveryLocation('?type=recovery'), true)
  assert.equal(isPasswordRecoveryLocation('?account=1', '#type=signup'), false)
  assert.equal(isPasswordRecoveryLocation(''), false)
})

test('saving a new password calls updateUser and stays signed in', async () => {
  const calls = []
  const supabase = {
    auth: {
      async updateUser(body) {
        calls.push(body)
        return { data: { user: { id: 'user_1', email: 'member@example.com' } }, error: null }
      },
      async signOut() {
        throw new Error('must not sign out')
      },
    },
  }
  const result = await applyNewPassword(supabase, 'newer-password')
  assert.deepEqual(calls, [{ password: 'newer-password' }])
  assert.equal(result.ok, true)
  assert.equal(result.signedIn, true)
  assert.equal(result.user.email, 'member@example.com')
  assert.equal(result.message, "Password updated. You're signed in.")

  const limited = await applyNewPassword({
    auth: {
      async updateUser() {
        return { data: { user: null }, error: { message: 'email rate limit exceeded', status: 429 } }
      },
    },
  }, 'newer-password')
  assert.equal(limited.ok, false)
  assert.equal(limited.signedIn, false)
  assert.equal(limited.message, AUTH_RATE_LIMIT_MESSAGE)
})

test('the reset form, recovery page, and listener are wired', () => {
  const authPage = read('src/AuthPage.jsx')
  const recoveryPage = read('src/SetNewPassword.jsx')
  const authContext = read('src/AuthContext.jsx')
  const app = read('src/App.jsx')
  const recovery = read('src/passwordRecovery.js')
  assert.match(authPage, /recoveryRedirectUrl\(/)
  assert.match(authPage, /authErrorMessage\(/)
  assert.match(authPage, /AUTH_RATE_LIMIT_MESSAGE|authErrorMessage/)
  assert.match(recovery, /updateUser\(\{ password \}\)/)
  assert.match(recoveryPage, /applyNewPassword\(/)
  assert.doesNotMatch(recoveryPage, /signOut/)
  assert.match(recoveryPage, /Set a new password/)
  assert.match(authContext, /PASSWORD_RECOVERY/)
  assert.match(authContext, /isPasswordRecoveryLocation/)
  assert.match(app, /SetNewPassword/)
  assert.match(app, /passwordRecovery/)
})

test('the manage-subscription 404 names the signed-in email', () => {
  const notice = noActivePlanNotice('member@example.com')
  assert.match(notice, /No active plan on this email\. DM @Cgpropz\./)
  assert.match(notice, /Signed in as member@example\.com — your plan may be under a different email\./)
  assert.equal(noActivePlanNotice(''), 'No active plan on this email. DM @Cgpropz.')
  const page = read('src/SubscriptionPage.jsx')
  assert.match(page, /noActivePlanNotice\(user\?\.email\)/)
})
