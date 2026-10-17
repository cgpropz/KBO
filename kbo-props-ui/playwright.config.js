import { defineConfig, devices } from '@playwright/test'

const safariUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const macSafariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

const mobileUse = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: safariUa,
}

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/phone-width.spec.js',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  projects: [
    {
      name: 'mobile',
      testIgnore: ['**/phone-width.spec.js', '**/webkit-member-scale.spec.js'],
      use: mobileUse,
    },
    {
      // Desktop-mode Safari: Mac UA, 980px layout viewport, iPhone 15 screen.
      name: 'webkit-member',
      testMatch: '**/webkit-member-scale.spec.js',
      use: {
        ...devices['iPhone 15'],
        userAgent: macSafariUa,
        viewport: { width: 980, height: 852 },
        screen: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
