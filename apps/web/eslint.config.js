import { defineConfig } from '@repo/eslint-config'

const pdfjsMessage = 'Use the PDF.js legacy build (pdfjs-dist/legacy/build/*): the modern build needs APIs that older Safari/iOS and WeChat lack. App code goes through src/services/pdfjs.ts.'

export default defineConfig(
  {
    type: 'app',
    // public/pdfjs is copied from pdfjs-dist at build time (vite.config.ts)
    ignores: ['public/**'],
  },
  {
    rules: {
      'ts/no-restricted-imports': ['error', {
        paths: [{ name: 'pdfjs-dist', message: pdfjsMessage, allowTypeImports: true }],
        patterns: [{ group: ['pdfjs-dist/build/*', 'pdfjs-dist/web/*'], message: pdfjsMessage, allowTypeImports: true }],
      }],
    },
  },
)
