import { defineConfig } from '@playwright/test'

const safariUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const chromeUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1'

const preview = process.env.PHONE_SKIP_BUILD === '1'
  ? 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
  : 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'

function phone(name, browserName, width, userAgent) {
  return {
    name,
    use: {
      browserName,
      userAgent,
      viewport: { width, height: 700 },
      screen: { width, height: width === 320 ? 568 : width === 430 ? 932 : 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
  }
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'phone-card-fit.spec.js',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [
    phone('chromium-320', 'chromium', 320, chromeUa),
    phone('chromium-390', 'chromium', 390, chromeUa),
    phone('webkit-320', 'webkit', 320, safariUa),
    phone('webkit-390', 'webkit', 390, safariUa),
    phone('chromium-430', 'chromium', 430, chromeUa),
    phone('webkit-430', 'webkit', 430, safariUa),
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: preview,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The edge board is behind the member plan check. A preview build with no
    // Supabase URL cannot finish that check, so the grid never paints. This
    // fake project is only the card-fit server, which rebuilds with these
    // values. The suite mocks every supabase.co request. Production deploys
    // and the phone-width bundle do not use them.
    env: {
      VITE_SUPABASE_URL: 'https://e2e-slip.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'e2e-card-fit-anon-key',
    },
  },
})
