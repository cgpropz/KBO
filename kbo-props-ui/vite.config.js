import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cssLayerPlugin } from './cssLayerPlugin.js'
import { PAID_DATA_DIRS, PAID_DATA_FILES } from './paidDataFiles.js'

// Vite copies everything in public/ into the build. The pipeline still writes
// paid snapshots into public/data locally (git-ignored working state), so strip
// them from the build output; production reads them via /api/data only.
function stripPaidData() {
  let outDir = 'dist'
  return {
    name: 'strip-paid-data',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const dataDir = resolve(outDir, 'data')
      for (const name of [...PAID_DATA_FILES, ...PAID_DATA_DIRS]) {
        const target = resolve(dataDir, name)
        if (existsSync(target)) rmSync(target, { recursive: true, force: true })
      }
    },
  }
}

// https://vite.dev/config/
// Vite preview does not apply vercel.json rewrites. Map the public pages the
// phone check opens so a local production build matches the live URLs.
// Local ?previewTier= screenshots. The dev server answers membership pause,
// cancel, and the billing portal for the dev-preview token only, using the
// real handlers and in-memory Stripe stand-ins. No live key and no network.
function devMembershipPreview() {
  return {
    name: 'dev-membership-preview',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = String(req.url || '').split('?')[0];
        const auth = req.headers.authorization || '';
        const isCancel = req.method === 'POST' && path === '/api/cancel-subscription';
        const isPortal = req.method === 'POST' && path === '/api/billing-portal';
        if ((!isCancel && !isPortal) || auth !== 'Bearer dev-preview') return next();
        try {
          const raw = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            req.on('error', reject);
          });
          let body = {};
          if (raw) {
            try { body = JSON.parse(raw); } catch { body = {}; }
          }
          const out = {
            statusCode: 200,
            body: undefined,
            setHeader() {},
            status(code) { this.statusCode = code; return this; },
            json(obj) { this.body = obj; return this; },
            end(msg) { this.body = msg; return this; },
          };
          if (isPortal) {
            const { handleBillingPortalRequest, devPreviewBillingDeps } = await import('./api/_billingPortal.js');
            await handleBillingPortalRequest(
              { method: 'POST', headers: { authorization: auth }, body },
              out,
              devPreviewBillingDeps(),
            );
          } else {
            const { handleMembershipRequest } = await import('./api/cancel-subscription.js');
            const { devPreviewMembershipDeps } = await import('./api/_pauseSubscription.js');
            await handleMembershipRequest(
              { method: 'POST', headers: { authorization: auth }, body },
              out,
              devPreviewMembershipDeps(),
            );
          }
          res.statusCode = out.statusCode;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'private, no-store');
          res.end(JSON.stringify(out.body ?? {}));
        } catch {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Dev membership preview failed' }));
        }
      });
    },
  };
}

function previewCleanUrls() {
  const map = {
    '/pricing': '/pricing.html',
    '/policies': '/policies.html',
    '/terms': '/terms.html',
    '/privacy': '/privacy.html',
    '/responsible-gaming': '/responsible-gaming.html',
    '/states-not-available': '/states-not-available.html',
    '/guides/start-here': '/guides/start-here.html',
    '/guides/cg-score': '/guides/cg-score.html',
  }
  const rewriteCleanUrl = (req) => {
    const raw = String(req.url || '')
    const path = raw.split('?')[0]
    if (!map[path]) return false
    const query = raw.includes('?') ? `?${raw.split('?')[1]}` : ''
    req.url = `${map[path]}${query}`
    return true
  }
  // Board logos request /api/img. That file is the sharp resizer. If the dev
  // server lets Vite transform it, the browser receives JavaScript, Vite
  // prebundles sharp, and the full reload drops the board mid-check.
  const serveResizedImage = async (req, res) => {
    const raw = String(req.url || '')
    try {
      const { default: handler } = await import('./api/img.js')
      const params = new URL(raw, 'http://127.0.0.1').searchParams
      await handler(
        { method: req.method || 'GET', query: { src: params.get('src') || '', w: params.get('w') || '' } },
        {
          setHeader(key, value) { res.setHeader(key, value) },
          end(body) { res.end(body) },
          get statusCode() { return res.statusCode },
          set statusCode(code) { res.statusCode = code },
        },
      )
    } catch {
      res.statusCode = 502
      res.end('Image unavailable')
    }
  }
  const imageOrNext = async (req, res, next) => {
    if (rewriteCleanUrl(req)) return next()
    const path = String(req.url || '').split('?')[0]
    if (path !== '/api/img') return next()
    await serveResizedImage(req, res)
  }
  return {
    name: 'preview-clean-urls',
    configureServer(server) {
      server.middlewares.use(imageOrNext)
    },
    configurePreviewServer(server) {
      server.middlewares.use(imageOrNext)
    },
  }
}

export default defineConfig({
  plugins: [cssLayerPlugin(), react(), stripPaidData(), previewCleanUrls(), devMembershipPreview()],
  // For GitHub Pages: set base to repo name, or '/' for custom domain
  base: process.env.GITHUB_PAGES ? '/KBO/' : '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/highcharts')) return 'highcharts'
        },
      },
    },
  },
})
