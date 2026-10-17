// Screenshots and mobile + desktop Lighthouse for a protected Vercel preview.
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
const BLOCKED = /espncdn|nfl\.com|cdn\.wnba\.com|nhle\.com|mykbostats|naverncp/i

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

function assertAvatars(info) {
  if (info.phoneImages !== 0) throw new Error(`hero phone has ${info.phoneImages} images`)
  if (!info.boardRows) throw new Error('landing board has no rows')
  for (const img of info.imgs) {
    if (img.loading !== 'lazy') throw new Error(`headshot is not lazy: ${img.src}`)
    if (!img.w || !img.h) throw new Error(`headshot is missing width or height: ${img.src}`)
    if (!img.src.startsWith('/api/img?')) throw new Error(`headshot skipped the image proxy: ${img.src}`)
    const decoded = decodeURIComponent(img.src)
    if (!decoded.includes('https://static.prizepicks.com/images/players/')) {
      throw new Error(`headshot is not a PrizePicks player image: ${img.src}`)
    }
    if (BLOCKED.test(decoded)) throw new Error(`blocked headshot host: ${img.src}`)
  }
}

async function openLanding(browser, secret, width, height) {
  const page = await browser.newPage({
    viewport: { width, height },
    extraHTTPHeaders: { 'x-vercel-protection-bypass': secret },
  })
  await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector('h1')
  await page.waitForSelector('#free-top-3 .pl-tr, #boards .pl-tr', { timeout: 25000 })
  return page
}

async function readAvatars(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img.pl-avatar')].map((img) => ({
      src: img.getAttribute('src') || '',
      w: img.getAttribute('width'),
      h: img.getAttribute('height'),
      loading: img.getAttribute('loading'),
      decoding: img.getAttribute('decoding'),
    }))
    return {
      imgs,
      initials: document.querySelectorAll('span.pl-avatar').length,
      phoneImages: document.querySelectorAll('.pl-phone img').length,
      boardRows: document.querySelectorAll('#free-top-3 .pl-tr, #boards .pl-tr').length,
      h1: (document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim(),
    }
  })
}

async function shoot(browser, secret, width, height, file) {
  const page = await openLanding(browser, secret, width, height)
  try {
    const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim()
    if (!h1.startsWith('Every prop line')) throw new Error(`unexpected h1: ${h1}`)
    await page.locator('#free-top-3').evaluate((node) => node.scrollIntoView({ block: 'start' }))
    const info = await readAvatars(page)
    assertAvatars(info)
    await page.screenshot({ path: file })
    return { width, file: file.split('/').pop(), ...info, imgs: info.imgs.length }
  } finally {
    await page.close()
  }
}

async function shootNhl(browser, secret, width, height, file) {
  // The landing no longer has an NHL tab and does not fetch that board.
  // The NHL sport page still shows its own free top 3 and proxied headshots.
  const page = await browser.newPage({
    viewport: { width, height },
    extraHTTPHeaders: { 'x-vercel-protection-bypass': secret },
  })
  const imgStatuses = []
  page.on('response', (response) => {
    try {
      if (new URL(response.url()).pathname === '/api/img') imgStatuses.push(response.status())
    } catch { /* ignore a bad response url */ }
  })
  try {
    const url = new URL(previewUrl)
    url.searchParams.set('sport', 'nhl')
    await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.nfl-lines-avatar img, .nfl-card-avatar img', { timeout: 25000 })
    const info = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.nfl-lines-avatar img, .nfl-card-avatar img')].map((img) => ({
        src: img.getAttribute('src') || '',
        loading: img.getAttribute('loading'),
      }))
      return {
        imgs,
        phoneImages: document.querySelectorAll('.pl-phone img').length,
        apiData: performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.includes('/api/data')),
      }
    })
    if (info.phoneImages !== 0) throw new Error(`hero phone has ${info.phoneImages} images`)
    if (!info.imgs.length) throw new Error('NHL page has no headshots')
    for (const img of info.imgs) {
      if (img.loading !== 'lazy') throw new Error(`headshot is not lazy: ${img.src}`)
      if (!img.src.startsWith('/api/img?')) throw new Error(`headshot skipped the image proxy: ${img.src}`)
      const decoded = decodeURIComponent(img.src)
      if (BLOCKED.test(decoded) || !decoded.includes('https://static.prizepicks.com/images/players/')) {
        throw new Error(`blocked headshot host: ${img.src}`)
      }
    }
    await page.screenshot({ path: file })
    return {
      width,
      file: file.split('/').pop(),
      sport: 'nhl',
      imgs: info.imgs.length,
      phoneImages: info.phoneImages,
      apiData: info.apiData,
      imgStatuses,
    }
  } finally {
    await page.close()
  }
}

async function sampleNhl(secret) {
  const response = await fetch(`${previewUrl.replace(/\/$/, '')}/api/data?ds=nhl_projections`, {
    headers: { 'x-vercel-protection-bypass': secret },
  })
  const text = await response.text()
  let body = {}
  try { body = JSON.parse(text) } catch { body = { error: 'not-json' } }
  const rows = Array.isArray(body?.data) ? body.data : []
  const summary = {
    status: response.status,
    error: typeof body?.error === 'string' ? body.error.slice(0, 120) : null,
    rows: rows.length,
    lockedCount: Number(body?.lockedCount) || 0,
    prizepicksImages: rows.filter((row) => String(row?.imageUrl || row?.ppImageUrl || '').includes('static.prizepicks.com')).length,
  }
  console.log(`nhl preview ${JSON.stringify(summary)}`)
  return summary
}

function lcpSelector(report) {
  const items = report.audits?.['largest-contentful-paint-element']?.details?.items || []
  for (const item of items) {
    const node = item?.node || item?.items?.[0]?.node
    if (node?.selector) return node.selector
  }
  return ''
}

async function lighthouse(chromePath, headersFile, form, index) {
  const output = new URL(`lh-${form}-${index}.json`, outDir)
  const args = [
    '--yes',
    'lighthouse@12.8.2',
    previewUrl,
    '--only-categories=performance',
    `--extra-headers=${headersFile}`,
    `--chrome-path=${chromePath}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--output=json',
    `--output-path=${output.pathname}`,
    '--quiet',
  ]
  if (form === 'desktop') args.push('--preset=desktop')
  else args.push('--form-factor=mobile', '--throttling-method=simulate')
  await run('npx', args, { ...process.env, CI: '1' })
  const report = JSON.parse(await readFile(output, 'utf8'))
  const audit = (id) => report.audits[id]?.numericValue
  const selector = lcpSelector(report)
  if (/pl-avatar|<img/i.test(selector)) {
    throw new Error(`${form} run ${index} LCP is a headshot (${selector})`)
  }
  return {
    form,
    performance: Math.round((report.categories.performance?.score || 0) * 100),
    fcpMs: Math.round(audit('first-contentful-paint') || 0),
    lcpMs: Math.round(audit('largest-contentful-paint') || 0),
    tbtMs: Math.round(audit('total-blocking-time') || 0),
    cls: Number((audit('cumulative-layout-shift') || 0).toFixed(3)),
    lcpSelector: selector,
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

const nhlApi = await sampleNhl(secret)
console.log(`nhl preview rows ${nhlApi.rows}, prizepicks images ${nhlApi.prizepicksImages}`)

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const pages = []
try {
  pages.push(await shoot(browser, secret, 1440, 1100, new URL('desktop.png', outDir).pathname))
  pages.push(await shoot(browser, secret, 390, 844, new URL('phone-390.png', outDir).pathname))
  pages.push(await shootNhl(browser, secret, 1440, 1100, new URL('desktop-nhl.png', outDir).pathname))
  pages.push(await shootNhl(browser, secret, 390, 844, new URL('phone-nhl-390.png', outDir).pathname))
} finally {
  await browser.close()
}

const runs = []
for (const form of ['mobile', 'desktop']) {
  for (let index = 1; index <= 3; index += 1) {
    const result = await lighthouse(chromium.executablePath(), headersFile, form, index)
    runs.push(result)
    console.log(`lighthouse ${form} run ${index}: ${result.performance}`)
  }
}
await rm(headersDir, { recursive: true, force: true })

function formMedian(form) {
  const subset = runs.filter((run) => run.form === form)
  return {
    performance: median(subset.map((run) => run.performance)),
    fcpMs: median(subset.map((run) => run.fcpMs)),
    lcpMs: median(subset.map((run) => run.lcpMs)),
    tbtMs: median(subset.map((run) => run.tbtMs)),
    cls: median(subset.map((run) => run.cls)),
  }
}

const summary = {
  url: previewUrl,
  nhlApi,
  pages,
  runs,
  median: {
    mobile: formMedian('mobile'),
    desktop: formMedian('desktop'),
  },
}
await writeFile(new URL('summary.json', outDir), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
