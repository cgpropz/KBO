import assert from 'node:assert/strict'
import test from 'node:test'
import { syncMemberSubscription } from '../api/sync-subscription.js'

function response() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    end() {
      return this
    },
  }
}

function dbFor({ tier = 'combined', claimError = null } = {}) {
  const state = { metadata: { provider: 'email', tier }, claimWrites: 0 }
  const chain = {
    select() { return chain },
    eq() { return chain },
    limit() { return Promise.resolve({ data: [{ tier }], error: null }) },
    upsert() { return Promise.resolve({ error: null }) },
  }
  return {
    state,
    from() { return chain },
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1', email: 'member@example.com' } }, error: null }
      },
      admin: {
        async getUserById() {
          if (claimError) return { error: claimError, data: { user: null } }
          return { data: { user: { id: 'user-1', app_metadata: { ...state.metadata } } } }
        },
        async updateUserById(_id, { app_metadata }) {
          state.claimWrites += 1
          if (claimError) return { error: claimError }
          state.metadata = { ...app_metadata }
          return { error: null }
        },
      },
    },
  }
}

async function post(db, stripe) {
  const res = response()
  await syncMemberSubscription(
    { method: 'POST', headers: { authorization: 'Bearer test-token' } },
    res,
    { supabase: db, stripe },
  )
  return res
}

test('sync returns 500 when the claim write fails', async () => {
  const paid = dbFor({ tier: 'combined', claimError: { message: 'auth down' } })
  const unchanged = await post(paid, { customers: { list() { throw new Error('paid profiles do not ask Stripe') } } })
  assert.equal(unchanged.statusCode, 500)
  assert.deepEqual(unchanged.body, { error: 'tier claim failed' })
  assert.equal(JSON.stringify(unchanged.body).includes('member@example.com'), false)

  const free = dbFor({ tier: 'free', claimError: { message: 'auth down' } })
  const cleared = await post(free, {
    customers: { async list() { return { data: [] } }, async search() { return { data: [] } } },
  })
  assert.equal(cleared.statusCode, 500)
  assert.deepEqual(cleared.body, { error: 'tier claim failed' })

  const grant = dbFor({ tier: 'free', claimError: { message: 'auth down' } })
  const granted = await post(grant, {
    customers: {
      async list() { return { data: [{ id: 'cus_1', email: 'member@example.com' }] } },
      async search() { return { data: [] } },
    },
    subscriptions: {
      async list() {
        return {
          data: [{
            id: 'sub_kbo',
            status: 'active',
            items: { data: [{ price: { id: 'price_1THCokPwL0k9PEMvcWwT7F2c' } }] },
          }],
        }
      },
    },
    charges: { async list() { return { data: [] } } },
  })
  assert.equal(granted.statusCode, 500)
  assert.deepEqual(granted.body, { error: 'tier claim failed' })
})
