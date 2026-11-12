import type { SaveMode } from '../pdf-exporter'
import type { Placement } from '@/types/signature'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'

import { inspectPages } from '../../../tests/helpers/drawn-images'
import { arrowSignaturePng } from '../../../tests/helpers/png'
import { checkSignatures, createSignedPdf, hasOpenssl } from '../../../tests/helpers/signed-pdf'
import { exportSignedPdf } from '../pdf-exporter'
import { describeDigitalSignatures } from '../pdf-inspector'

const images = new Map([['sig', arrowSignaturePng()]])
const placement: Placement = { id: 'p0', sourceId: 'sig', pageIndex: 0, xRatio: 0.6, yRatio: 0.8, widthRatio: 0.3, heightRatio: 0.106 }

async function exportOnto(original: Uint8Array, saveMode: SaveMode = 'auto') {
  const pages = (await inspectPages(original)).map(page => page.geometry)
  return exportSignedPdf({ originalBytes: original, pages, images, placements: [placement], saveMode })
}

// Existing digital signatures (PRD FR-01, FR-06): a CMS signature only covers the bytes of the
// revision it signed, so it survives exactly when the export leaves those bytes untouched.
describe.runIf(hasOpenssl())('exporting a digitally signed PDF', () => {
  it('starts from a signature that verifies (test harness)', async () => {
    expect(checkSignatures(await createSignedPdf())).toEqual([
      expect.objectContaining({ valid: true, coversWholeFile: true }),
    ])
  })

  it('detects approval and certification signatures', async () => {
    const signaturesOf = async (bytes: Uint8Array) => describeDigitalSignatures(await PDFDocument.load(bytes))

    expect(await signaturesOf(await createSignedPdf())).toEqual({ signedFields: 1, certification: undefined })
    expect(await signaturesOf(await createSignedPdf({ certify: 1 }))).toEqual({ signedFields: 1, certification: 1 })
    expect(await signaturesOf(await createSignedPdf({ certify: 3 }))).toEqual({ signedFields: 1, certification: 3 })
  })

  it('breaks the signature when the file is rewritten', async () => {
    const { bytes } = await exportOnto(await createSignedPdf(), 'rewrite')

    expect(checkSignatures(bytes).map(check => check.valid)).toEqual([false])
  })

  it('appends by default and keeps the signature valid', async () => {
    const original = await createSignedPdf()
    const { bytes, incremental } = await exportOnto(original)

    expect(incremental).toBe(true)
    expect(bytes.subarray(0, original.length)).toEqual(original)
    expect(checkSignatures(bytes)).toEqual([
      expect.objectContaining({ valid: true, coversWholeFile: false }),
    ])
  })

  it('keeps the signature field in the latest revision', async () => {
    const { bytes } = await exportOnto(await createSignedPdf())
    const fields = (await PDFDocument.load(bytes)).getForm().getFields()

    expect(fields.map(field => field.getName())).toEqual(['Signature1'])
  })

  it('places the drawing correctly in the appended revision', async () => {
    const [page] = await inspectPages((await exportOnto(await createSignedPdf())).bytes)

    expect(page!.images).toHaveLength(1)
    expect(page!.images[0]!.topLeft[0]).toBeCloseTo(placement.xRatio, 6)
    expect(page!.images[0]!.topLeft[1]).toBeCloseTo(placement.yRatio, 6)
  })

  // `pnpm samples:pdf` also writes these, to check how signature validators report each case
  it.runIf(process.env.WRITE_SAMPLES)('writes samples for signature validators', async () => {
    const outDir = fileURLToPath(new URL('../../../tests/fixtures/out/', import.meta.url))
    mkdirSync(outDir, { recursive: true })
    for (const [name, certify] of [['approval-signed', undefined], ['certified-p2', 2], ['certified-p3', 3]] as const) {
      const original = await createSignedPdf({ certify })
      writeFileSync(join(outDir, `${name}.pdf`), original)
      writeFileSync(join(outDir, `${name}_inksign-incremental.pdf`), (await exportOnto(original, 'incremental')).bytes)
      writeFileSync(join(outDir, `${name}_inksign-rewrite.pdf`), (await exportOnto(original, 'rewrite')).bytes)
    }
  })
})
