// Screenshots and mobile Lighthouse for a protected Vercel preview.
// The bypass secret stays in memory and in a mode-600 headers file. Never print it.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const previewUrl = process.env.PREVIEW_URL
const vercelToken = process.env.VERCEL_TOKEN
const teamId = 'team_NsMEVaPP3l5Ouz0DWr1y9cxU'
const projectId = 'prj_HgdvsekuqCfqzKYvGAUD6gQi36AW'
const outDir = new URL('../preview-audit/', import.meta.url)

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
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

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}`))
    })
  })
}

async function shoot(browser, secret, width, height, file) {
  const page = await browser.newPage({
    viewport: { width, height },
    extraHTTPHeaders: { 'x-vercel-protection-bypass': secret },
  })
  await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector('h1')
  await page.screenshot({ path: file })
  const hero = page.locator('.pl-hero')
  const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim()
  const heroText = (await hero.innerText()).replace(/\s+/g, ' ')
  const marks = await page.locator('img[src="/favicon.svg"]').count()
  const members = await page.getByText('Members', { exact: true }).count()
  const reviews = await page.locator('#reviews').count()
  const selected = (await page.locator('[role="tab"][aria-selected="true"]').first().innerText()).trim()
  const phone = (await page.locator('.v1-ab-tag').innerText()).trim()
  if (h1 !== 'Every prop line, scored.') throw new Error(`unexpected h1: ${h1}`)
  if (/PrizePicks|DraftKings|FanDuel|Underdog|sportsbook/i.test(heroText)) {
    throw new Error('hero copy still names a sportsbook')
  }
  if (marks !== 1) throw new Error(`expected one CG mark, saw ${marks}`)
  if (members !== 0) throw new Error('members stat is still on the page')
  if (reviews !== 0) throw new Error('reviews section is visible with no real reviews')
  if (selected !== 'NFL') throw new Error(`selected sport is ${selected}`)
  if (!phone.startsWith('NFL')) throw new Error(`phone sport is ${phone}`)
  await page.close()
}

async function lighthouse(chromePath, headersFile, index) {
  const output = new URL(`lh-${index}.json`, outDir)
  await run('npx', [
    '--yes',
    'lighthouse@12.8.2',
    previewUrl,
    '--only-categories=performance',
    '--form-factor=mobile',
    '--throttling-method=simulate',
    `--extra-headers=${headersFile}`,
    `--chrome-path=${chromePath}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--output=json',
    `--output-path=${output.pathname}`,
    '--quiet',
  ], { ...process.env, CI: '1' })
  const report = JSON.parse(await readFile(output, 'utf8'))
  const audit = (id) => report.audits[id]?.numericValue
  return {
    performance: Math.round((report.categories.performance?.score || 0) * 100),
    fcpMs: Math.round(audit('first-contentful-paint') || 0),
    lcpMs: Math.round(audit('largest-contentful-paint') || 0),
    tbtMs: Math.round(audit('total-blocking-time') || 0),
    cls: Number((audit('cumulative-layout-shift') || 0).toFixed(3)),
    lcpElement: report.audits['largest-contentful-paint-element']?.displayValue || '',
  }
}

if (!previewUrl || !vercelToken) {
  console.error('PREVIEW_URL and VERCEL_TOKEN are required')
  process.exit(1)
}

const secret = await automationBypass()
const headersDir = await mkdtemp(join(tmpdir(), 'lh-'))
const headersFile = join(headersDir, 'headers.json')
await writeFile(headersFile, JSON.stringify({ 'x-vercel-protection-bypass': secret }), { mode: 0o600 })
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ args: ['--no-sandbox'] })
try {
  await shoot(browser, secret, 1440, 1100, new URL('desktop.png', outDir).pathname)
  await shoot(browser, secret, 390, 844, new URL('phone-390.png', outDir).pathname)
} finally {
  await browser.close()
}

const runs = []
for (let index = 1; index <= 3; index += 1) {
  runs.push(await lighthouse(chromium.executablePath(), headersFile, index))
  console.log(`lighthouse run ${index}: ${runs[index - 1].performance}`)
}
await rm(headersDir, { recursive: true, force: true })

const summary = {
  url: previewUrl,
  runs,
  median: {
    performance: median(runs.map((run) => run.performance)),
    fcpMs: median(runs.map((run) => run.fcpMs)),
    lcpMs: median(runs.map((run) => run.lcpMs)),
    tbtMs: median(runs.map((run) => run.tbtMs)),
    cls: median(runs.map((run) => run.cls)),
  },
}
await writeFile(new URL('summary.json', outDir), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
