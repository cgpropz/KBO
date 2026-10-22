// Production member-board check. Logs status and timing only.
// The access token and the member email never appear in logs or issues.

import { fileURLToPath } from 'node:url'

export const ISSUE_TITLE = 'site-monitor: member boards'
export const READ_BUDGET_MS = 5_000
export const MONITOR_DATASETS = [
  'prizepicks_props',
  'strikeout_projections',
  'batter_projections',
  'nfl_projections',
  'nhl_projections',
  'wnba_projections_standard',
  'nfl_sharp_odds',
]

export function monitorHour(date = new Date(), timeZone = 'America/New_York') {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date).find((part) => part.type === 'hour')?.value
  return Number(hour)
}

// Midnight through 5:59 AM Eastern is quiet time. Hour 6 is open.
export function monitorShouldRun(date = new Date(), { force = false } = {}) {
  if (force) return true
  return monitorHour(date) >= 6
}

export function probeFailure(probe, budgetMs = READ_BUDGET_MS) {
  const reasons = []
  if (probe.status !== 200) {
    reasons.push(probe.status === 503 ? '503' : `status ${probe.status ?? 'missing'}`)
  }
  if (Number(probe.ms) > budgetMs) reasons.push(`read ${probe.ms}ms`)
  if (probe.preview === true || probe.tier === 'free') reasons.push('free tier')
  return reasons
}

export function formatReport({ checkedAt, origin, results }) {
  const lines = [
    `Checked ${origin}/api/data at ${checkedAt}.`,
    '',
    '| dataset | status | ms | preview | tier |',
    '| --- | --- | --- | --- | --- |',
  ]
  const failures = []
  for (const probe of results) {
    const reasons = probe.reasons || probeFailure(probe)
    lines.push(`| ${probe.ds} | ${probe.status ?? ''} | ${probe.ms ?? ''} | ${probe.preview === true ? 'yes' : 'no'} | ${probe.tier || ''} |`)
    if (reasons.length) failures.push(`- ${probe.ds}: ${reasons.join(', ')}`)
  }
  lines.push('', failures.length ? 'Failures:' : 'All member boards returned paid data within 5s.', ...failures)
  return lines.join('\n')
}

export async function probeBoard(fetchImpl, { origin, token, ds, timeoutMs = 7_000 }) {
  const started = performance.now()
  let response
  try {
    response = await fetchImpl(`${origin}/api/data?ds=${encodeURIComponent(ds)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ds, status: 0, ms: Math.round(performance.now() - started), preview: null, tier: null }
  }
  const ms = Math.round(performance.now() - started)
  let preview = null
  let tier = null
  try {
    const body = await response.json()
    preview = body?.preview === true
    tier = typeof body?.tier === 'string' ? body.tier : null
  } catch {
    preview = null
    tier = null
  }
  return { ds, status: response.status, ms, preview, tier }
}

function safeSignInReason(err) {
  const message = err?.message || ''
  if (message === 'site monitor is not configured') return message
  if (/^(magic link failed|verify failed) \(\d+\)$/.test(message)) return message
  if (message === 'magic link failed (no hash)') return message
  return 'sign-in failed'
}

export async function memberAccessToken(fetchImpl, env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || ''
  const anon = env.VITE_SUPABASE_ANON_KEY || ''
  const email = env.SITE_MONITOR_EMAIL || ''
  if (!url || !key || !anon || !email) throw new Error('site monitor is not configured')
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
  const link = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'magiclink', email }),
    signal: AbortSignal.timeout(8_000),
  })
  const linkBody = await link.json().catch(() => ({}))
  if (!link.ok) throw new Error(`magic link failed (${link.status})`)
  const hashed = linkBody?.properties?.hashed_token || linkBody?.hashed_token
  if (!hashed) throw new Error('magic link failed (no hash)')
  const verified = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
    signal: AbortSignal.timeout(8_000),
  })
  const session = await verified.json().catch(() => ({}))
  if (!verified.ok || !session.access_token) throw new Error(`verify failed (${verified.status})`)
  return session.access_token
}

export function githubIssues({ fetchImpl, token, repo }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
  const base = `https://api.github.com/repos/${repo}`
  async function read(response, label) {
    if (response.ok) return response.json().catch(() => ({}))
    throw new Error(`${label} failed (${response.status})`)
  }
  return {
    async findOpen() {
      const query = encodeURIComponent(`repo:${repo} is:issue is:open in:title "${ISSUE_TITLE}"`)
      const response = await fetchImpl(`https://api.github.com/search/issues?q=${query}&per_page=5`, { headers })
      const body = await read(response, 'issue search')
      const match = (body.items || []).find((issue) => issue.title === ISSUE_TITLE && !issue.pull_request)
      return match ? { number: match.number } : null
    },
    async create({ title, body }) {
      let response = await fetchImpl(`${base}/issues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title, body, labels: ['site-monitor'] }),
      })
      if (response.status === 422) {
        response = await fetchImpl(`${base}/issues`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title, body }),
        })
      }
      const created = await read(response, 'issue create')
      return { number: created.number }
    },
    async comment(number, body) {
      const response = await fetchImpl(`${base}/issues/${number}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body }),
      })
      await read(response, 'issue comment')
    },
    async close(number) {
      const response = await fetchImpl(`${base}/issues/${number}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      })
      await read(response, 'issue close')
    },
  }
}

export async function runSiteMonitor({
  now = new Date(),
  force = false,
  origin = 'https://www.cgpropz.com',
  probes,
  issues,
  log = () => {},
}) {
  if (!monitorShouldRun(now, { force })) {
    log(JSON.stringify({ event: 'site_monitor', skipped: true, hour: monitorHour(now) }))
    return { skipped: true, failed: false }
  }
  let results
  try {
    results = await probes()
  } catch (err) {
    results = [{ ds: 'sign-in', status: 0, ms: 0, preview: null, tier: null, reasons: [safeSignInReason(err)] }]
  }
  const report = formatReport({ checkedAt: now.toISOString(), origin, results })
  const failed = results.some((probe) => (probe.reasons || probeFailure(probe)).length > 0)
  log(JSON.stringify({
    event: 'site_monitor',
    ok: !failed,
    checks: results.map((probe) => ({
      ds: probe.ds,
      status: probe.status,
      ms: probe.ms,
      preview: probe.preview === true,
      tier: probe.tier || null,
    })),
  }))
  const open = await issues.findOpen()
  if (failed) {
    if (open) await issues.comment(open.number, report)
    else await issues.create({ title: ISSUE_TITLE, body: report })
    return { skipped: false, failed: true }
  }
  if (open) {
    await issues.comment(open.number, `Recovered at ${now.toISOString()}. Member boards returned paid data within 5s.`)
    await issues.close(open.number)
  }
  return { skipped: false, failed: false }
}

async function main() {
  const force = process.env.MONITOR_FORCE === '1' || process.env.MONITOR_FORCE === 'true'
  const origin = (process.env.SITE_ORIGIN || 'https://www.cgpropz.com').replace(/\/$/, '')
  const repo = process.env.GITHUB_REPOSITORY || 'cgpropz/KBO'
  const issues = githubIssues({
    fetchImpl: fetch,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
    repo,
  })
  const outcome = await runSiteMonitor({
    force,
    origin,
    issues,
    log: (line) => console.log(line),
    probes: async () => {
      const token = await memberAccessToken(fetch, process.env)
      const results = []
      for (const ds of MONITOR_DATASETS) {
        results.push(await probeBoard(fetch, { origin, token, ds }))
      }
      return results
    },
  })
  if (outcome.failed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.log(JSON.stringify({ event: 'site_monitor', ok: false, error: safeSignInReason(err) }))
    process.exitCode = 1
  })
}
