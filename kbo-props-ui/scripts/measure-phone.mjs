// Throttled iPhone measurement. About 1.6 Mbps and 150 ms delay.
// Usage: node scripts/measure-phone.mjs <url> [label]
import { chromium } from '@playwright/test'

const url = process.argv[2]
const label = process.argv[3] || url
if (!url) {
  console.error('Usage: node scripts/measure-phone.mjs <url> [label]')
  process.exit(1)
}

const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: safari,
})
const page = await context.newPage()
const client = await context.newCDPSession(page)
await client.send('Network.enable')
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
})

const resources = new Map()
client.on('Network.responseReceived', (event) => {
  const mime = event.response.mimeType || ''
  const kind = event.type === 'Image' || mime.startsWith('image/')
    ? 'image'
    : event.type === 'Font' || mime.includes('font')
      ? 'font'
      : null
  if (!kind) return
  resources.set(event.requestId, { kind, url: event.response.url, mime, status: event.response.status, bytes: 0 })
})
client.on('Network.loadingFinished', (event) => {
  const row = resources.get(event.requestId)
  if (row) row.bytes = event.encodedDataLength || 0
})

await page.addInitScript(() => {
  window.__boardAt = null
  window.__lcpMs = null
  const mark = () => {
    if (window.__boardAt != null) return
    if (document.querySelector('table.hit-rate-board tbody tr, .kbo-player-cell, .wnba-lines-row, .nfl-lines-row, .nfl-card, .pl-hero')) {
      window.__boardAt = performance.now()
    }
  }
  new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true })
  try {
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1)
      if (last) window.__lcpMs = last.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch { /* older browsers */ }
})

await page.route('**/*', async (route) => {
  const host = new URL(route.request().url()).hostname
  if (/(^|\.)twitter\.com$|(^|\.)t\.co$|google-analytics|googletagmanager|doubleclick/.test(host)) {
    await route.abort()
    return
  }
  if (url.startsWith('http://127.0.0.1') && route.request().url().includes('/api/data')) {
    const current = new URL(route.request().url())
    const response = await fetch(`https://cgpropz.com${current.pathname}${current.search}`, { headers: { Accept: 'application/json' } })
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      body: await response.text(),
    })
    return
  }
  await route.continue()
})

const ready = 'table.hit-rate-board tbody tr, .kbo-player-cell, .nfl-lines-row, .nfl-lines-page, .wnba-lines-page, .pl-hero'
let boardError = null
await page.goto(url, { waitUntil: 'commit', timeout: 90_000 })
try {
  await page.waitForSelector(ready, { timeout: 40_000 })
} catch (err) {
  boardError = 'board did not appear'
}
const boardMs = boardError ? null : await page.evaluate(() => Math.round(performance.now()))
await page.waitForTimeout(2500)
const paint = await page.evaluate(() => new Promise((resolve) => {
  let lcp = null
  try {
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1)
      if (last) lcp = last.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch (err) {
    resolve({ lcpMs: null, lcpError: String(err) })
    return
  }
  setTimeout(() => resolve({ lcpMs: lcp == null ? null : Math.round(lcp) }), 300)
}))
paint.boardMs = boardError ? null : boardMs
paint.boardError = boardError

const rows = [...resources.values()]
const sum = (kind) => rows.filter((row) => row.kind === kind).reduce((total, row) => total + row.bytes, 0)
const images = rows.filter((row) => row.kind === 'image').sort((a, b) => b.bytes - a.bytes)
const result = {
  label,
  url,
  imageBytes: sum('image'),
  imageCount: images.length,
  fontBytes: sum('font'),
  fontCount: rows.filter((row) => row.kind === 'font').length,
  ...paint,
  largestImages: images.slice(0, 8).map((row) => ({ bytes: row.bytes, url: row.url.slice(0, 140) })),
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
