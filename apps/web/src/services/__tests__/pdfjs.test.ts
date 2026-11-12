import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { pdfjsAssetOptions } from '../pdfjs'

describe('pdfjs service', () => {
  it('runs the legacy worker', () => {
    expect(GlobalWorkerOptions.workerSrc).toMatch(/pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs/)
  })

  it('loads every runtime asset from our own origin (FR-02, FR-07)', () => {
    const urls = [pdfjsAssetOptions.cMapUrl, pdfjsAssetOptions.standardFontDataUrl, pdfjsAssetOptions.wasmUrl, pdfjsAssetOptions.iccUrl]
    for (const url of urls)
      expect(url).toMatch(/^\/pdfjs\/[a-z_]+\/$/)
  })
})
