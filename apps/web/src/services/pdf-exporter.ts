import type { PDFImage } from '@cantoo/pdf-lib'
import type { PageGeometry } from './coordinate-transform'
import type { Placement } from '@/types/signature'
import { degrees, PDFDocument } from '@cantoo/pdf-lib'

import { placementToDrawParams } from './coordinate-transform'
import { describeDigitalSignatures } from './pdf-inspector'

/**
 * How the new file is written:
 * - `incremental` appends the changes; the original stays a byte-exact prefix, so digital
 *   signatures made before keep verifying.
 * - `rewrite` writes a fresh file, which also repairs a damaged structure (e.g. wrong xref offsets).
 * - `auto` (default) appends when the PDF carries digital signatures and rewrites otherwise.
 */
export type SaveMode = 'auto' | 'incremental' | 'rewrite'

export interface ExportInput {
  /** The untouched bytes of the opened PDF; every export starts again from them (PRD §7) */
  originalBytes: Uint8Array
  /** Geometry of every page as previewed by PDF.js, indexed by page */
  pages: readonly PageGeometry[]
  /** PNG bytes by `SignatureSource.id` */
  images: ReadonlyMap<string, Uint8Array>
  placements: readonly Placement[]
  saveMode?: SaveMode
}

export interface ExportResult {
  bytes: Uint8Array
  /** Whether the changes were appended to the original (`auto` resolved) */
  incremental: boolean
}

/** Draws the placed images onto a copy of the original PDF and returns the new file (FR-06). */
export async function exportSignedPdf({ originalBytes, pages, images, placements, saveMode = 'auto' }: ExportInput): Promise<ExportResult> {
  // Loaded for incremental update in every mode: `save({ rewrite: true })` still writes a full file.
  // Keep the author's Producer/Creator/dates instead of stamping pdf-lib's.
  const doc = await PDFDocument.load(originalBytes, { updateMetadata: false, forIncrementalUpdate: true })
  if (doc.getPageCount() !== pages.length)
    throw new Error(`Page count mismatch: PDF has ${doc.getPageCount()}, preview has ${pages.length}`)

  const incremental = saveMode === 'auto' ? describeDigitalSignatures(doc).signedFields > 0 : saveMode === 'incremental'

  // One embedded image per signature, shared by all its placements
  const embedded = new Map<string, PDFImage>()
  for (const placement of placements) {
    const geometry = pages[placement.pageIndex]
    if (!geometry)
      throw new Error(`Placement ${placement.id} is on page ${placement.pageIndex}, which does not exist`)

    let image = embedded.get(placement.sourceId)
    if (!image) {
      const png = images.get(placement.sourceId)
      if (!png)
        throw new Error(`Missing image for signature ${placement.sourceId}`)
      image = await doc.embedPng(png)
      embedded.set(placement.sourceId, image)
    }

    const { x, y, width, height, rotation } = placementToDrawParams(geometry, placement)
    doc.getPage(placement.pageIndex).drawImage(image, { x, y, width, height, rotate: degrees(rotation) })
  }

  return { bytes: await doc.save({ rewrite: !incremental }), incremental }
}
