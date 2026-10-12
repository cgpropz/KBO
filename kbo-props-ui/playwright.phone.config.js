import { defineConfig } from '@playwright/test'

const safariUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const twitterUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone'

const preview = process.env.PHONE_SKIP_BUILD === '1'
  ? 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
  : 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'phone-width.spec.js',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [
    { name: 'iphone-safari', use: { userAgent: safariUa } },
    { name: 'twitter-ios', use: { userAgent: twitterUa } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  webServer: {
    command: preview,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
