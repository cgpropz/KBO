import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // For GitHub Pages: set base to repo name, or '/' for custom domain
  base: process.env.GITHUB_PAGES ? '/KBO/' : '/',
})
