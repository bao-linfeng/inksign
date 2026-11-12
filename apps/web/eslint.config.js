import { defineConfig } from '@repo/eslint-config'

export default defineConfig({
  type: 'app',
  // public/pdfjs is copied from pdfjs-dist at build time (vite.config.ts)
  ignores: ['public/**'],
})
