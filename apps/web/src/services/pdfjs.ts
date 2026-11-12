import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// The legacy build: the modern one relies on very recent APIs (e.g. Uint8Array.prototype.toHex on
// every load), which older Safari/iOS and WeChat's built-in browser lack.
// The worker and every runtime asset come from our own origin (PRD FR-02, FR-07); vite.config.ts
// copies the assets into public/pdfjs.
GlobalWorkerOptions.workerSrc = workerUrl

const assetBase = `${import.meta.env.BASE_URL}pdfjs/`

export const pdfjsAssetOptions = {
  cMapUrl: `${assetBase}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assetBase}standard_fonts/`,
  wasmUrl: `${assetBase}wasm/`,
  iccUrl: `${assetBase}iccs/`,
  enableXfa: false,
} satisfies DocumentInitParameters

/**
 * Starts loading a PDF for preview; `destroy()` the returned task (or `pdf.loadingTask`) when done
 * to stop its worker. PDF.js transfers the buffer it receives to the worker, so it gets a copy and
 * the caller's bytes stay usable for export.
 */
export function openPdf(bytes: Uint8Array) {
  return getDocument({ ...pdfjsAssetOptions, data: bytes.slice() })
}
