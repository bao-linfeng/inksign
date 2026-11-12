import type { PDFImage } from '@cantoo/pdf-lib'
import type { PageGeometry } from './coordinate-transform'
import type { Placement } from '@/types/signature'
import { degrees, PDFDocument } from '@cantoo/pdf-lib'

import { placementToDrawParams } from './coordinate-transform'

export interface ExportInput {
  /** The untouched bytes of the opened PDF; every export starts again from them (PRD §7) */
  originalBytes: Uint8Array
  /** Geometry of every page as previewed by PDF.js, indexed by page */
  pages: readonly PageGeometry[]
  /** PNG bytes by `SignatureSource.id` */
  images: ReadonlyMap<string, Uint8Array>
  placements: readonly Placement[]
}

/** Draws the placed images onto a copy of the original PDF and returns the new file (FR-06). */
export async function exportSignedPdf({ originalBytes, pages, images, placements }: ExportInput): Promise<Uint8Array> {
  // Keep the author's Producer/Creator/dates instead of stamping pdf-lib's
  const doc = await PDFDocument.load(originalBytes, { updateMetadata: false })
  if (doc.getPageCount() !== pages.length)
    throw new Error(`Page count mismatch: PDF has ${doc.getPageCount()}, preview has ${pages.length}`)

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

  return doc.save()
}
