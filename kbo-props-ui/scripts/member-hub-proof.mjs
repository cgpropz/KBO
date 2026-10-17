// Cold signed-in timings for a protected preview. No screenshots.
// Tokens and the service key stay in memory. Never print them.

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { chromium } from '@playwright/test'
import { supabaseStorageKey } from '../src/supabaseClient.js'

const previewUrl = (process.env.PREVIEW_URL || '').replace(/\/$/, '')
const prodUrl = (process.env.PROD_URL || 'https://www.cgpropz.com').replace(/\/$/, '')
const vercelToken = process.env.VERCEL_TOKEN
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.env.MEMBER_EMAIL || 'sev1-hub-preview@example.com'
const teamId = 'team_NsMEVaPP3l5Ouz0DWr1y9cxU'
const projectId = 'prj_HgdvsekuqCfqzKYvGAUD6gQi36AW'
const outDir = new URL('../member-hub-proof/', import.meta.url)
const cleanupOnly = process.argv.includes('--cleanup')

const PHONE = { width: 390, height: 844 }
const PAGE_PATHS = [
  ['nflDashboard', '/?sport=nfl'],
  ['nhlDashboard', '/?sport=nhl'],
  ['nflBoard', '/?sport=nfl&page=projections'],
  ['nhlBoard', '/?sport=nhl&page=projections'],
]
const CARD_SELECTOR = '[data-testid="prop-line-card"], table.hit-rate-board tbody tr, .nfl-edge-card'

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

async function profileTier(id) {
  const response = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=tier`, {
    headers: serviceHeaders(),
    signal: AbortSignal.timeout(8_000),
  })
  const rows = await response.json().catch(() => [])
  return Array.isArray(rows) ? (rows[0]?.tier || '') : ''
}

async function upsertTier(id) {
  const headers = {
    ...serviceHeaders(),
    Prefer: 'return=representation,resolution=merge-duplicates',
  }
  const patch = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ tier: 'combined' }),
  })
  const patched = await patch.json().catch(() => [])
  const patchedTier = Array.isArray(patched) ? patched[0]?.tier : ''
  if (!patch.ok || patchedTier !== 'combined') {
    const post = await fetch(`${supabaseUrl}/rest/v1/user_profiles?on_conflict=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, tier: 'combined' }),
    })
    if (!post.ok) throw new Error(`tier upsert failed (${post.status} ${await errorCode(post)})`)
  }
  const tier = await profileTier(id)
  if (tier !== 'combined') throw new Error(`proof member tier is ${tier || 'missing'}`)
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
    tier: typeof body.tier === 'string' ? body.tier : null,
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

function median(values) {
  const nums = [...values]
  if (!nums.length || nums.some((value) => !Number.isFinite(value))) return null
  const sorted = nums.sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function classifyOdds(rows) {
  const counts = { goblin: 0, demon: 0, missing: 0, unknown: 0, standard: 0, rows: rows.length }
  for (const row of rows) {
    const raw = row?.oddsType ?? row?.odds_type ?? row?.line_type ?? row?.lineType
    if (raw == null || String(raw).trim() === '') counts.missing += 1
    else {
      const type = String(raw).trim().toLowerCase()
      if (type === 'goblin' || type === 'demon' || type === 'standard') counts[type] += 1
      else counts.unknown += 1
    }
  }
  return counts
}

function sessionJson(session) {
  const expiresIn = Number(session.expires_in) || 3600
  const expiresAt = Number(session.expires_at) || Math.floor(Date.now() / 1000) + expiresIn
  return JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: expiresAt,
    expires_in: expiresIn,
    token_type: session.token_type || 'bearer',
    user: session.user,
  })
}

async function nhlOddsCounts(base, { bypass, accessToken }) {
  const headers = { Authorization: `Bearer ${accessToken}` }
  if (bypass) headers['x-vercel-protection-bypass'] = bypass
  const response = await fetch(`${base}/api/data?ds=nhl_projections`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let body = {}
  try { body = JSON.parse(text) } catch { body = {} }
  const rows = Array.isArray(body.data) ? body.data : []
  return { status: response.status, ...classifyOdds(rows) }
}

async function clientAuthStorageKeys(base, bypass) {
  const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {}
  const keys = new Set()
  const envKey = supabaseStorageKey(supabaseUrl)
  if (envKey) keys.add(envKey)
  const seen = new Set()
  const queue = [`${base}/`]
  let foundInBundle = false
  const take = (text) => {
    for (const match of text.matchAll(/https:\/\/[a-z0-9-]+\.supabase\.co/gi)) {
      const key = supabaseStorageKey(match[0])
      if (key) keys.add(key)
      foundInBundle = true
    }
    for (const match of text.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.js/g)) {
      const next = new URL(match[0], base).toString()
      if (!seen.has(next)) queue.push(next)
    }
  }
  let scanned = 0
  while (queue.length && scanned < 12 && !foundInBundle) {
    const url = queue.shift()
    if (seen.has(url)) continue
    seen.add(url)
    scanned += 1
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null)
    if (!response?.ok) continue
    take(await response.text())
  }
  return { keys: [...keys], foundInBundle }
}

async function pageHint(page) {
  try {
    return await page.evaluate(() => {
      const heading = (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const paywall = Boolean(document.querySelector('.pw-title'))
      const keys = Object.keys(localStorage).filter((key) => /^sb-[a-z0-9-]+-auth-token$/.test(key))
      let session = false
      let tierMatch = false
      let tier = 'none'
      try {
        const cached = JSON.parse(sessionStorage.getItem('cg_tier') || 'null')
        tier = typeof cached?.tier === 'string' ? cached.tier : 'none'
        for (const key of keys) {
          const id = JSON.parse(localStorage.getItem(key) || 'null')?.user?.id
          if (!id) continue
          session = true
          if (cached?.userId === id) tierMatch = true
        }
      } catch {
        tier = 'bad'
      }
      return ` h1=${heading || 'none'} paywall=${paywall} session=${session} tier=${tier} tierMatch=${tierMatch} keys=${keys.length}`
    })
  } catch {
    return ''
  }
}

function memberStorageState(base, storageKeys, storedSession) {
  const origin = new URL(base).origin
  return {
    cookies: [],
    origins: storageKeys.length
      ? [{ origin, localStorage: storageKeys.map((name) => ({ name, value: storedSession })) }]
      : [],
  }
}

async function timeColdPage(browser, { base, path, bypass, storageKeys, storedSession }) {
  const context = await browser.newContext({
    viewport: PHONE,
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
    storageState: memberStorageState(base, storageKeys, storedSession),
  })
  let page
  try {
    // sessionStorage is not part of storageState. Derive the cached tier from
    // the session user id in the page so the two cannot drift apart.
    await context.addInitScript(({ keys, value }) => {
      try {
        for (const key of keys) localStorage.setItem(key, value)
        const userId = JSON.parse(value)?.user?.id
        if (userId) sessionStorage.setItem('cg_tier', JSON.stringify({ userId, tier: 'combined' }))
      } catch { /* the page still loads logged out */ }
    }, { keys: storageKeys, value: storedSession })
    page = await context.newPage()
    const started = performance.now()
    const target = new URL(path, base)
    if (bypass) {
      target.searchParams.set('x-vercel-protection-bypass', bypass)
      target.searchParams.set('x-vercel-set-bypass-cookie', 'true')
    }
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForSelector(CARD_SELECTOR, { timeout: 30_000 })
    const firstCardMs = Math.round(performance.now() - started)
    const api = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/api/data'))
      .map((entry) => {
        let ds = null
        try { ds = new URL(entry.name).searchParams.get('ds') } catch { ds = null }
        return { ds, ms: Math.round(entry.duration) }
      }))
    const dom = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      return {
        goblin: (text.match(/GOBLIN/g) || []).length,
        demon: (text.match(/DEMON/g) || []).length,
        cards: document.querySelectorAll('[data-testid="prop-line-card"]').length,
        rows: document.querySelectorAll('table.hit-rate-board tbody tr, .nfl-edge-card').length,
      }
    })
    return { firstCardMs, api, dom }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'page failed'
    const hint = page ? await pageHint(page) : ''
    const text = `${message}${hint}`
    return { error: bypass ? text.split(bypass).join('[bypass]') : text }
  } finally {
    await context.close()
  }
}

async function timeHost(browser, { label, base, bypass, storageKeys, storedSession }) {
  const pages = {}
  for (const [name, path] of PAGE_PATHS) {
    const runs = []
    for (let index = 0; index < 3; index += 1) {
      try {
        runs.push(await timeColdPage(browser, { base, path, bypass, storageKeys, storedSession }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'page failed'
        runs.push({ error: bypass ? message.split(bypass).join('[bypass]') : message })
      }
    }
    pages[name] = {
      runs: runs.map((run) => ({
        firstCardMs: run.firstCardMs ?? null,
        api: run.api || [],
        dom: run.dom || null,
        error: run.error || null,
      })),
      medianFirstCardMs: median(runs.map((run) => run.firstCardMs)),
    }
  }
  return { label, viewport: PHONE, pages }
}

function previewOddsClean(counts) {
  return counts
    && counts.status === 200
    && counts.goblin === 0
    && counts.demon === 0
    && counts.missing === 0
    && counts.unknown === 0
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
    const storedSession = sessionJson(session)
    const [prodAuth, previewAuth] = await Promise.all([
      clientAuthStorageKeys(prodUrl, null),
      clientAuthStorageKeys(previewUrl, bypass),
    ])
    const browser = await chromium.launch({ headless: true })
    let browserReport
    let goblin
    try {
      goblin = {
        prod: await nhlOddsCounts(prodUrl, { accessToken: session.access_token }),
        preview: await nhlOddsCounts(previewUrl, { bypass, accessToken: session.access_token }),
      }
      browserReport = {
        prod: await timeHost(browser, { label: 'prod', base: prodUrl, storageKeys: prodAuth.keys, storedSession }),
        preview: await timeHost(browser, { label: 'preview', base: previewUrl, bypass, storageKeys: previewAuth.keys, storedSession }),
      }
    } finally {
      await browser.close()
    }
    const report = {
      viewport: PHONE,
      authBundle: { prod: prodAuth.foundInBundle, preview: previewAuth.foundInBundle },
      cold: { nhl, nfl },
      burst: burst.map((hub) => ({
        wallMs: hub.wallMs,
        nflMs: hub.calls.find((call) => call.ds === 'nfl_projections')?.ms ?? null,
        nhlMs: hub.calls.find((call) => call.ds === 'nhl_projections')?.ms ?? null,
        calls: hub.calls,
      })),
      browser: browserReport,
      goblin,
    }
    await writeFile(new URL('./timings.json', outDir), `${JSON.stringify(report, null, 2)}\n`)
    const summary = {
      cold: { nhl: { ms: nhl.ms, status: nhl.status, rows: nhl.rows, preview: nhl.preview }, nfl: { ms: nfl.ms, status: nfl.status, rows: nfl.rows, preview: nfl.preview } },
      burst: report.burst.map((hub) => ({ wallMs: hub.wallMs, nflMs: hub.nflMs, nhlMs: hub.nhlMs })),
      browser: {
        prod: Object.fromEntries(Object.entries(browserReport.prod.pages).map(([name, page]) => [name, page.medianFirstCardMs])),
        preview: Object.fromEntries(Object.entries(browserReport.preview.pages).map(([name, page]) => [name, page.medianFirstCardMs])),
      },
      goblin,
    }
    console.log(JSON.stringify(summary))
    const pageFailed = Object.values(browserReport.preview.pages).some((page) => page.medianFirstCardMs == null)
      || Object.values(browserReport.prod.pages).some((page) => page.medianFirstCardMs == null)
    const domPromo = Object.values(browserReport.preview.pages).some((page) => page.runs.some((run) => (run.dom?.goblin || 0) > 0 || (run.dom?.demon || 0) > 0))
    if (nhl.status !== 200 || nfl.status !== 200 || pageFailed || domPromo || !previewOddsClean(goblin.preview)) process.exitCode = 1
  } finally {
    await cleanup()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'member hub proof failed')
  process.exit(1)
})
