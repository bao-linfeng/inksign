import type { PlacementRect } from '@/types/signature'

export type PageRotation = 0 | 90 | 180 | 270

/**
 * What the user sees of a page, as reported by PDF.js: `view` is the CropBox clipped to the
 * MediaBox in PDF user space (`[x0, y0, x1, y1]`), `rotation` the normalized `/Rotate`.
 */
export interface PageGeometry {
  view: readonly [number, number, number, number]
  rotation: PageRotation
}

/** Arguments for pdf-lib's `drawImage`, in PDF user space. */
export interface DrawParams {
  x: number
  y: number
  width: number
  height: number
  /** Counter-clockwise, in degrees */
  rotation: PageRotation
}

/** Normalizes `/Rotate` the way PDF.js does: values that are not multiples of 90 count as 0. */
export function normalizeRotation(degrees: number): PageRotation {
  if (!Number.isInteger(degrees) || degrees % 90 !== 0)
    return 0
  return (((degrees % 360) + 360) % 360) as PageRotation
}

/** Builds the geometry from a PDF.js page proxy (`page.view`, `page.rotate`). */
export function pageGeometryOf(page: { view: number[], rotate: number }): PageGeometry {
  const [x0, y0, x1, y1] = page.view as [number, number, number, number]
  return { view: [x0, y0, x1, y1], rotation: normalizeRotation(page.rotate) }
}

/** Size of the visible page in user-space units; width and height swap on quarter turns. */
export function visibleSize({ view: [x0, y0, x1, y1], rotation }: PageGeometry) {
  const width = x1 - x0
  const height = y1 - y0
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

/**
 * Maps a point of the visible page (user-space units, origin at the top-left corner, y down) to
 * PDF user space. Equivalent to PDF.js `viewport.convertToPdfPoint` at scale 1 and UserUnit 1.
 */
export function visibleToPdfPoint({ view: [x0, y0, x1, y1], rotation }: PageGeometry, vx: number, vy: number): [number, number] {
  switch (rotation) {
    case 0:
      return [x0 + vx, y1 - vy]
    case 90:
      return [x0 + vy, y0 + vx]
    case 180:
      return [x1 - vx, y0 + vy]
    case 270:
      return [x1 - vy, y1 - vx]
  }
}

/**
 * Where to draw an image so it shows upright at `rect` on the visible page (PRD §6). The origin is
 * the image's visual bottom-left corner; the image is turned counter-clockwise by the page rotation,
 * which the viewer's clockwise page rotation cancels out. Width and height stay in visible
 * orientation.
 */
export function placementToDrawParams(geometry: PageGeometry, rect: PlacementRect): DrawParams {
  const size = visibleSize(geometry)
  const left = rect.xRatio * size.width
  const top = rect.yRatio * size.height
  const width = rect.widthRatio * size.width
  const height = rect.heightRatio * size.height
  const [x, y] = visibleToPdfPoint(geometry, left, top + height)
  return { x, y, width, height, rotation: geometry.rotation }
}
