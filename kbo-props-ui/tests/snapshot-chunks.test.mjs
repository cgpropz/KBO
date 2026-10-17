// Chunk reassembly for /api/data (member hub and ?view=hub), the landing
// bake, and the last-good bucket. No network.
import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleSnapshotRows } from '../api/_snapshotChunks.js'
import { handleDataRequest, _clearCache, readLastGood } from '../api/data.js'
import { completePublishedRow } from '../scripts/bake-landing-preview.mjs'

const VERSION = '2026-10-17T01:54:00+00:00'
const OLD = '2026-10-16T00:00:00+00:00'

function chunk(id, index, rows, version = VERSION) {
  return {
    id,
    updated_at: version,
    data: { version, generated_at: version, index, kind: 'list', rows },
  }
}

function manifest(ids, version = VERSION) {
  return {
    data: {
      snapshotChunks: { version, generated_at: version, kind: 'list', ids },
    },
    updated_at: version,
  }
}

const board = [
  { player: 'First', projection: 4, line: 2.5, rankEligible: true },
  { player: 'Second', projection: 3, line: 2.5, rankEligible: true },
  { player: 'Third', projection: 2, line: 2.5, rankEligible: true },
  { player: 'Fourth', projection: 1, line: 2.5, rankEligible: true },
]

test('chunks join in order and a single row stays the stored payload', () => {
  const head = manifest([50000, 50001])
  const joined = assembleSnapshotRows(head, [
    chunk(50001, 1, board.slice(2)),
    chunk(50000, 0, board.slice(0, 2)),
  ])
  assert.deepEqual(joined.data, board)
  assert.equal(joined.updated_at, VERSION)

  const legacy = { data: board, updated_at: OLD }
  assert.equal(assembleSnapshotRows(legacy, []), legacy)

  const objectHead = {
    data: {
      snapshotChunks: { version: VERSION, generated_at: VERSION, kind: 'object', ids: [70, 71] },
    },
    updated_at: VERSION,
  }
  const objectJoined = assembleSnapshotRows(objectHead, [
    { id: 71, data: { version: VERSION, generated_at: VERSION, index: 1, kind: 'object', object: { b: 2 } }, updated_at: VERSION },
    { id: 70, data: { version: VERSION, generated_at: VERSION, index: 0, kind: 'object', object: { a: 1 } }, updated_at: VERSION },
  ])
  assert.deepEqual(objectJoined.data, { a: 1, b: 2 })
})

test('a partial or mixed chunk set is rejected', () => {
  const head = manifest([50000, 50001])
  assert.throws(
    () => assembleSnapshotRows(head, [chunk(50000, 0, board.slice(0, 2))]),
    /missing chunk/,
  )
  assert.throws(
    () => assembleSnapshotRows(head, [
      chunk(50000, 0, board.slice(0, 2)),
      chunk(50001, 1, board.slice(2), OLD),
    ]),
    /mixed/,
  )
  assert.throws(
    () => assembleSnapshotRows(head, [
      chunk(50000, 0, board.slice(0, 2)),
      { id: 50001, data: { version: VERSION, generated_at: VERSION, index: 0, kind: 'list', rows: board.slice(2) } },
    ]),
    /mixed/,
  )
  assert.throws(
    () => assembleSnapshotRows({ data: { snapshotChunks: { version: VERSION, kind: 'list', ids: [] } } }, []),
    /invalid/,
  )
})

test('the landing bake joins chunks and leaves a single row alone', () => {
  const head = manifest([50000, 50001])
  assert.deepEqual(
    completePublishedRow(head, [chunk(50000, 0, board.slice(0, 2)), chunk(50001, 1, board.slice(2))]).data,
    board,
  )
  const legacy = { data: board, updated_at: VERSION }
  assert.equal(completePublishedRow(legacy, []), legacy)
  assert.throws(
    () => completePublishedRow(head, [chunk(50000, 0, board.slice(0, 2))]),
    /missing chunk/,
  )
})

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockClient(chunks) {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: 'u-fan', email: 'fan@example.com' } }, error: null }
      },
    },
    from(table) {
      const filters = {}
      const chain = {
        select() { return chain },
        eq(col, val) { filters[col] = val; return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') {
            return Promise.resolve({ data: { tier: 'combined' }, error: null })
          }
          if (filters.id === 1) {
            return Promise.resolve({ data: { id: 1, ...manifest([50000, 50001]) }, error: null })
          }
          const row = chunks.find((item) => item.id === filters.id) || null
          return Promise.resolve({ data: row, error: null })
        },
      }
      return chain
    },
  }
}

async function call(chunks, { token = 'tok', player } = {}) {
  _clearCache()
  const res = mockRes()
  await handleDataRequest(
    {
      method: 'GET',
      query: { ds: 'nhl_projections', ...(player ? { player } : {}) },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
    res,
    mockClient(chunks),
  )
  return res
}

test('member hub and view=hub receive the reassembled board, not one chunk', async () => {
  const chunks = [chunk(50000, 0, board.slice(0, 2)), chunk(50001, 1, board.slice(2))]
  const member = await call(chunks)
  assert.equal(member.statusCode, 200)
  assert.equal(member.body.preview, false)
  assert.deepEqual(member.body.data.map((row) => row.player), ['First', 'Second', 'Third', 'Fourth'])

  const page = await call(chunks, { player: 'Second' })
  assert.equal(page.statusCode, 200)
  assert.deepEqual(page.body.data.map((row) => row.player), ['Second'])

  const preview = await call(chunks, { token: '' })
  assert.equal(preview.body.preview, true)
  assert.equal(preview.body.data.length, 3)
  assert.equal(preview.body.lockedCount, 1)
  assert.deepEqual(preview.body.data.map((row) => row.player), ['First', 'Second', 'Third'])
})

test('a mixed or partial chunk set is not served as the board', async () => {
  const mixed = await call([
    chunk(50000, 0, board.slice(0, 2)),
    chunk(50001, 1, board.slice(2), OLD),
  ])
  assert.equal(mixed.statusCode, 502)
  assert.equal(mixed.body.data, undefined)

  const partial = await call([chunk(50000, 0, board.slice(0, 2))])
  assert.equal(partial.statusCode, 502)
  assert.equal(partial.body.data, undefined)
})

test('last-good serves the full board and refuses a chunk manifest', async () => {
  const now = new Date().toISOString()
  const blob = (obj) => ({ text: async () => JSON.stringify(obj) })
  const client = {
    storage: {
      from: () => ({
        download: async () => ({ data: blob({ data: board, updated_at: now }), error: null }),
      }),
    },
  }
  assert.deepEqual((await readLastGood(client, 'nhl_projections')).data, board)
  const manifestBlob = {
    storage: {
      from: () => ({
        download: async () => ({
          data: blob({ data: manifest([1, 2]).data, updated_at: now }),
          error: null,
        }),
      }),
    },
  }
  assert.equal(await readLastGood(manifestBlob, 'nhl_projections'), null)
})
