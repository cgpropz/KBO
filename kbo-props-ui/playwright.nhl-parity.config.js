import { defineConfig } from '@playwright/test'

// NHL player page parity at phone width, made-up data only.
// - 4176: a production bundle. The NHL API sections are off there whatever
//   the URL says (NHL_API_SECTIONS_APPROVED is false).
// - 4175: the vite dev server, where ?nhlApiPreview=1 previews them.
// Both use the fake Supabase project the card-fit suite uses so the mocked
// member session can finish the plan check.

const chromeUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1'
const safariUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const fakeSupabase = {
  VITE_SUPABASE_URL: 'https://e2e-slip.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'e2e-card-fit-anon-key',
}

function phone(name, browserName, width, userAgent) {
  return {
    name,
    use: {
      browserName,
      userAgent,
      viewport: { width, height: 844 },
      screen: { width, height: width === 320 ? 568 : 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
  }
}

export default defineConfig({
  testDir: './e2e',
  testMatch: ['nhl-player-parity.spec.js'],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [
    phone('chromium-320', 'chromium', 320, chromeUa),
    phone('chromium-390', 'chromium', 390, chromeUa),
    phone('webkit-390', 'webkit', 390, safariUa),
  ],
  webServer: [
    {
      command: 'npx vite --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: fakeSupabase,
    },
    {
      command: 'npx vite build --outDir dist-nhl-parity && npx vite preview --outDir dist-nhl-parity --host 127.0.0.1 --port 4176 --strictPort',
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: fakeSupabase,
    },
  ],
})
