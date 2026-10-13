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
// Local ?previewTier= screenshots. The dev server answers membership pause and
// cancel for the dev-preview token only, using the real handler and an
// in-memory Stripe stand-in. No live key and no network.
function devMembershipPreview() {
  return {
    name: 'dev-membership-preview',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = String(req.url || '').split('?')[0];
        if (req.method !== 'POST' || path !== '/api/cancel-subscription') return next();
        const auth = req.headers.authorization || '';
        if (auth !== 'Bearer dev-preview') return next();
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
          const { handleMembershipRequest } = await import('./api/cancel-subscription.js');
          const { devPreviewMembershipDeps } = await import('./api/_pauseSubscription.js');
          const out = {
            statusCode: 200,
            body: undefined,
            setHeader() {},
            status(code) { this.statusCode = code; return this; },
            json(obj) { this.body = obj; return this; },
            end(msg) { this.body = msg; return this; },
          };
          await handleMembershipRequest(
            { method: 'POST', headers: { authorization: auth }, body },
            out,
            devPreviewMembershipDeps(),
          );
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
    '/guides/start-here': '/guides/start-here.html',
    '/guides/cg-score': '/guides/cg-score.html',
  }
  return {
    name: 'preview-clean-urls',
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = String(req.url || '')
        const path = raw.split('?')[0]
        if (map[path]) {
          const query = raw.includes('?') ? `?${raw.split('?')[1]}` : ''
          req.url = `${map[path]}${query}`
          return next()
        }
        if (path !== '/api/img') return next()
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
        } catch (err) {
          res.statusCode = 502
          res.end('Image unavailable')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [cssLayerPlugin(), react(), stripPaidData(), previewCleanUrls(), devMembershipPreview()],
  // For GitHub Pages: set base to repo name, or '/' for custom domain
  base: process.env.GITHUB_PAGES ? '/KBO/' : '/',
})
