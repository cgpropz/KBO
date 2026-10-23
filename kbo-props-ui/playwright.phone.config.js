import { defineConfig } from '@playwright/test'

const safariUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const twitterUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone'
const macSafariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const phoneScreen = { width: 390, height: 844 }

const preview = process.env.PHONE_SKIP_BUILD === '1'
  ? 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
  : 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['phone-width.spec.js', 'player-insights-phone.spec.js'],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [
    {
      name: 'iphone-safari',
      use: {
        userAgent: safariUa,
        viewport: { width: 390, height: 844 },
        screen: phoneScreen,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'twitter-ios',
      use: {
        userAgent: twitterUa,
        viewport: { width: 390, height: 844 },
        screen: phoneScreen,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      // Safari "Request Desktop Website": layout viewport 980, Mac UA, but the
      // device is still a touch phone so the board stays on cards.
      name: 'iphone-desktop-site',
      use: {
        userAgent: macSafariUa,
        viewport: { width: 980, height: 844 },
        screen: phoneScreen,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      // Page zoom at 50% stretches a 390px phone to about 780. The device
      // stays a touch phone, so the board stays on cards.
      name: 'width-780',
      use: {
        userAgent: safariUa,
        viewport: { width: 780, height: 844 },
        screen: phoneScreen,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: preview,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
