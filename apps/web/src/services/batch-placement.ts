import type { PageSize } from './placement'
import type { PlacementRect } from '@/types/signature'

import { clampToPage, toBox, toRect } from './placement'

/** Page choices of “应用到多页” (PRD FR-10) */
export type PageRangeKind = 'all' | 'all-but-last' | 'last' | 'custom'

export const PAGE_RANGE_ERROR = '页码范围无效，请输入如 1-3,5 的格式，且不超过总页数。'

const RANGE = /^(\d+)(?:-(\d+))?$/

/**
 * Parses a custom range such as `1-3,5` (one-based, inclusive) into sorted zero-based page
 * indexes. Chinese commas and `、` separate too, `~` joins too. `null` when anything is invalid.
 */
export function parsePageRange(input: string, pageCount: number): number[] | null {
  const normalized = input.replace(/[–—~～]/g, '-').replace(/\s*-\s*/g, '-').replace(/[，、;；\s]+/g, ',')
  const parts = normalized.split(',').filter(Boolean)
  if (!parts.length)
    return null
  const pages = new Set<number>()
  for (const part of parts) {
    const match = RANGE.exec(part)
    if (!match)
      return null
    const first = Number(match[1])
    const last = match[2] === undefined ? first : Number(match[2])
    if (first < 1 || last < first || last > pageCount)
      return null
    for (let page = first; page <= last; page++)
      pages.add(page - 1)
  }
  return [...pages].sort((a, b) => a - b)
}

/** Zero-based pages for a range choice, or `null` when a custom range is invalid. */
export function pagesFor(kind: PageRangeKind, pageCount: number, custom = ''): number[] | null {
  const all = Array.from({ length: pageCount }, (_, index) => index)
  switch (kind) {
    case 'all':
      return all
    case 'all-but-last':
      return all.slice(0, -1)
    case 'last':
      return all.slice(-1)
    case 'custom':
      return parsePageRange(custom, pageCount)
  }
}

/**
 * Where a copy of `rect` (on a page of size `from`) goes on a page of size `to` (PRD FR-10): the
 * corner of the page nearest to it is the anchor, the margins to that corner and the absolute size
 * stay the same, so the copy looks identical on pages of other sizes. Too large for the page, it is
 * scaled down; it never leaves the page. Sizes are in visible-page units, so rotation is included.
 */
export function anchoredRect(rect: PlacementRect, from: PageSize, to: PageSize): PlacementRect {
  const box = toBox(rect, from)
  const right = box.x + box.width / 2 > from.width / 2
  const bottom = box.y + box.height / 2 > from.height / 2
  const marginX = right ? from.width - box.x - box.width : box.x
  const marginY = bottom ? from.height - box.y - box.height : box.y

  const scale = Math.min(1, to.width / box.width, to.height / box.height)
  const width = box.width * scale
  const height = box.height * scale
  return clampToPage(toRect({
    x: right ? to.width - marginX - width : marginX,
    y: bottom ? to.height - marginY - height : marginY,
    width,
    height,
  }, to))
}
