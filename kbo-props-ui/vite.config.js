import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
export default defineConfig({
  plugins: [react(), stripPaidData()],
  // For GitHub Pages: set base to repo name, or '/' for custom domain
  base: process.env.GITHUB_PAGES ? '/KBO/' : '/',
})
