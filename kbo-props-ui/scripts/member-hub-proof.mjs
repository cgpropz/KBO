// Cold signed-in timings for a protected preview. No screenshots.
// Tokens and the service key stay in memory. Never print them.

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const previewUrl = (process.env.PREVIEW_URL || '').replace(/\/$/, '')
const vercelToken = process.env.VERCEL_TOKEN
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.env.MEMBER_EMAIL || 'sev1-hub-preview@example.com'
const teamId = 'team_NsMEVaPP3l5Ouz0DWr1y9cxU'
const projectId = 'prj_HgdvsekuqCfqzKYvGAUD6gQi36AW'
const outDir = new URL('../member-hub-proof/', import.meta.url)
const cleanupOnly = process.argv.includes('--cleanup')

const HUB_GROUPS = [
  ['nfl_projections', 'nfl_lineups'],
  ['prizepicks_props'],
  ['wnba_projections_standard', 'wnba_players', 'wnba_lineups'],
  ['nhl_projections', 'nhl_lineups'],
]

let userId = null
let cleaning = null

function required(name, value) {
  if (!value) throw new Error(`missing ${name}`)
  return value
}

async function automationBypass() {
  const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`, {
    headers: { Authorization: `Bearer ${vercelToken}` },
  })
  if (!response.ok) throw new Error(`project lookup failed (${response.status})`)
  const project = await response.json()
  const tokens = project.protectionBypass || {}
  const secret = Object.keys(tokens).find((key) => tokens[key]?.scope === 'automation-bypass')
  if (!secret) throw new Error('no automation bypass token on the project')
  return secret
}

function serviceHeaders() {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
}

async function errorCode(response) {
  try {
    const body = await response.json()
    return body.error_code || body.error || body.msg || body.message || response.status
  } catch {
    return response.status
  }
}

async function findUserId() {
  const url = new URL(`${supabaseUrl}/auth/v1/admin/users`)
  url.searchParams.set('filter', email)
  url.searchParams.set('per_page', '20')
  const response = await fetch(url, { headers: serviceHeaders(), signal: AbortSignal.timeout(8_000) })
  if (!response.ok) return null
  const body = await response.json().catch(() => ({}))
  const users = Array.isArray(body.users) ? body.users : []
  return users.find((user) => user?.email === email)?.id || null
}

async function createUser() {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (response.ok && body.id) return body.id
  if (response.status === 422) return findUserId()
  throw new Error(`create member failed (${response.status} ${body.error_code || body.error || body.msg || response.status})`)
}

async function generateLink() {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`magic link failed (${response.status} ${body.error_code || body.error || body.msg || ''})`)
  }
  const hashed = body?.properties?.hashed_token || body?.hashed_token
  if (!hashed) throw new Error('magic link did not return a token hash')
  return hashed
}

async function verify(tokenHash) {
  const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token || !body.user?.id) {
    throw new Error(`verify failed (${response.status} ${body.error_code || body.error || body.msg || ''})`)
  }
  return body
}

async function upsertTier(id) {
  const response = await fetch(`${supabaseUrl}/rest/v1/user_profiles?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(),
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id, tier: 'combined' }),
  })
  if (!response.ok) throw new Error(`tier upsert failed (${response.status} ${await errorCode(response)})`)
}

async function deleteMember(id) {
  if (!id) return
  await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${id}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {})
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {})
}

function cleanup() {
  if (cleaning) return cleaning
  cleaning = (async () => {
    const id = userId || await findUserId()
    await deleteMember(id)
  })().catch(() => {})
  return cleaning
}

process.on('SIGTERM', () => { cleanup().finally(() => process.exit(143)) })
process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)) })

async function timedFetch(ds, { bypass, accessToken }) {
  const started = performance.now()
  const response = await fetch(`${previewUrl}/api/data?ds=${encodeURIComponent(ds)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-vercel-protection-bypass': bypass,
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  const ms = Math.round(performance.now() - started)
  let body = {}
  try { body = JSON.parse(text) } catch { body = {} }
  const data = body?.data
  const rows = Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 0)
  return {
    ds,
    ms,
    status: response.status,
    bytes: Buffer.byteLength(text),
    preview: body.preview === true,
    rows,
    error: typeof body.error === 'string' ? body.error.slice(0, 160) : null,
    cache: response.headers.get('x-vercel-cache'),
  }
}

async function oneHub(bypass, accessToken, groups) {
  const started = performance.now()
  const calls = []
  for (const group of groups) {
    const results = await Promise.all(group.map((ds) => timedFetch(ds, { bypass, accessToken })))
    calls.push(...results)
  }
  return { wallMs: Math.round(performance.now() - started), calls }
}

async function main() {
  required('VITE_SUPABASE_URL', supabaseUrl)
  required('SUPABASE_SERVICE_ROLE_KEY', serviceKey)
  if (cleanupOnly) {
    await cleanup()
    return
  }
  required('PREVIEW_URL', previewUrl)
  required('VERCEL_TOKEN', vercelToken)
  required('VITE_SUPABASE_ANON_KEY', anonKey)
  await mkdir(outDir, { recursive: true })

  try {
    userId = await createUser()
    const tokenHash = await generateLink()
    const session = await verify(tokenHash)
    userId = session.user.id || userId
    await upsertTier(userId)
    const bypass = await automationBypass()
    const nhl = await timedFetch('nhl_projections', { bypass, accessToken: session.access_token })
    const nfl = await timedFetch('nfl_projections', { bypass, accessToken: session.access_token })
    const nba = await fetch(`${previewUrl}/api/nba-access`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'x-vercel-protection-bypass': bypass,
      },
    }).then((res) => res.json()).catch(() => ({ open: false }))
    const groups = nba?.open === true
      ? [...HUB_GROUPS, ['nba_projections_standard', 'nba_players']]
      : HUB_GROUPS
    const burst = await Promise.all([
      oneHub(bypass, session.access_token, groups),
      oneHub(bypass, session.access_token, groups),
      oneHub(bypass, session.access_token, groups),
    ])
    const report = {
      cold: { nhl, nfl },
      burst: burst.map((hub) => ({
        wallMs: hub.wallMs,
        nflMs: hub.calls.find((call) => call.ds === 'nfl_projections')?.ms ?? null,
        nhlMs: hub.calls.find((call) => call.ds === 'nhl_projections')?.ms ?? null,
        calls: hub.calls,
      })),
    }
    await writeFile(new URL('./timings.json', outDir), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({
      cold: { nhl: { ms: nhl.ms, status: nhl.status, rows: nhl.rows, preview: nhl.preview }, nfl: { ms: nfl.ms, status: nfl.status, rows: nfl.rows, preview: nfl.preview } },
      burst: report.burst.map((hub) => ({ wallMs: hub.wallMs, nflMs: hub.nflMs, nhlMs: hub.nhlMs })),
    }))
    if (nhl.status !== 200 || nfl.status !== 200) process.exitCode = 1
  } finally {
    await cleanup()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'member hub proof failed')
  process.exit(1)
})
