import type { Plugin } from 'vite'
import { cpSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const publicDir = fileURLToPath(new URL('./public', import.meta.url))

/**
 * Copies the PDF.js runtime assets (CMaps for CJK fonts, standard fonts, wasm decoders, ICC profiles)
 * from the installed pdfjs-dist into public/pdfjs, so they are served from our own origin (PRD FR-02)
 * and always match the installed version. public/pdfjs is generated and git-ignored.
 */
function pdfjsAssets(): Plugin {
  return {
    name: 'inksign:pdfjs-assets',
    buildStart() {
      const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
      const target = join(publicDir, 'pdfjs')
      rmSync(target, { recursive: true, force: true })
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs'])
        cpSync(join(pdfjsRoot, dir), join(target, dir), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [pdfjsAssets(), vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    // Node on Windows resolves `localhost` to ::1 only; browsers behind a proxy or TUN mode often try
    // 127.0.0.1 and get refused. IPv4 loopback works for both URLs without exposing the LAN.
    host: '127.0.0.1',
    port: 5020,
    strictPort: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.d.ts', 'src/**/__tests__/**'],
    },
  },
})
