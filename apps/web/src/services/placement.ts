import type { PlacementRect } from '@/types/signature'

/** Size of the visible page, in the same unit for both sides (PDF.js scale 1) */
export interface PageSize {
  width: number
  height: number
}

/** A new signature is about 5 cm wide, but never more than 40 % of the page (PRD FR-05) */
const DEFAULT_WIDTH = 150
const DEFAULT_MAX_SHARE = 0.4
/** Smallest side a signature can be shrunk to, so it stays visible and grabbable */
export const MIN_SIDE = 12

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function toBox(rect: PlacementRect, page: PageSize): Box {
  return { x: rect.xRatio * page.width, y: rect.yRatio * page.height, width: rect.widthRatio * page.width, height: rect.heightRatio * page.height }
}

function toRect(box: Box, page: PageSize): PlacementRect {
  return { xRatio: box.x / page.width, yRatio: box.y / page.height, widthRatio: box.width / page.width, heightRatio: box.height / page.height }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Keeps the size and moves the rectangle back inside the page. */
export function clampToPage(rect: PlacementRect): PlacementRect {
  return {
    ...rect,
    xRatio: clamp(rect.xRatio, 0, Math.max(0, 1 - rect.widthRatio)),
    yRatio: clamp(rect.yRatio, 0, Math.max(0, 1 - rect.heightRatio)),
  }
}

/**
 * Where a signature lands when the page is clicked at `center` (ratios of the visible page):
 * centred on that point, keeping the image's `aspect` (width / height), inside the page.
 */
export function initialRect(page: PageSize, aspect: number, center: { x: number, y: number }): PlacementRect {
  let width = Math.min(DEFAULT_WIDTH, page.width * DEFAULT_MAX_SHARE)
  let height = width / aspect
  if (height > page.height * DEFAULT_MAX_SHARE) {
    height = page.height * DEFAULT_MAX_SHARE
    width = height * aspect
  }
  const box = { x: center.x * page.width - width / 2, y: center.y * page.height - height / 2, width, height }
  return clampToPage(toRect(box, page))
}

/** Moves by a distance given as ratios of the page, staying on the page. */
export function moveBy(rect: PlacementRect, dx: number, dy: number): PlacementRect {
  return clampToPage({ ...rect, xRatio: rect.xRatio + dx, yRatio: rect.yRatio + dy })
}

/**
 * Drags `corner` by (dx, dy) (ratios of the page) while the opposite corner stays put. The aspect
 * ratio is kept, the result never leaves the page and no side gets shorter than `MIN_SIDE`.
 */
export function resizeFromCorner(rect: PlacementRect, corner: Corner, dx: number, dy: number, page: PageSize): PlacementRect {
  const box = toBox(rect, page)
  const growsRight = corner === 'ne' || corner === 'se'
  const growsDown = corner === 'sw' || corner === 'se'
  const right = box.x + box.width
  const bottom = box.y + box.height

  // Follow the pointer on average along both axes
  const wanted = ((box.width + (growsRight ? 1 : -1) * dx * page.width) / box.width
    + (box.height + (growsDown ? 1 : -1) * dy * page.height) / box.height) / 2
  const room = Math.min(
    (growsRight ? page.width - box.x : right) / box.width,
    (growsDown ? page.height - box.y : bottom) / box.height,
  )
  const smallest = MIN_SIDE / Math.min(box.width, box.height)
  const scale = clamp(wanted, Math.min(smallest, room), room)

  const width = box.width * scale
  const height = box.height * scale
  return toRect({
    x: growsRight ? box.x : right - width,
    y: growsDown ? box.y : bottom - height,
    width,
    height,
  }, page)
}
