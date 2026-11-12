import type { PlacementRect } from '@/types/signature'
import { describe, expect, it } from 'vitest'

import { clampToPage, initialRect, MIN_SIDE, moveBy, rectBelow, refitAspect, resizeFromCorner } from '../placement'

const a4 = { width: 595, height: 842 }

/** Rectangle in page units, for readable expectations */
function box(rect: PlacementRect, page = a4) {
  return {
    x: rect.xRatio * page.width,
    y: rect.yRatio * page.height,
    width: rect.widthRatio * page.width,
    height: rect.heightRatio * page.height,
  }
}

function expectBox(rect: PlacementRect, expected: ReturnType<typeof box>, page = a4) {
  const actual = box(rect, page)
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(actual[key], key).toBeCloseTo(expected[key], 6)
}

describe('initialRect', () => {
  it('centres a 150-point wide signature on the click, keeping its aspect ratio', () => {
    expectBox(initialRect(a4, 3, { x: 0.5, y: 0.5 }), { x: 297.5 - 75, y: 421 - 25, width: 150, height: 50 })
  })

  it('stays on the page when clicked near an edge', () => {
    expectBox(initialRect(a4, 3, { x: 0.99, y: 0.01 }), { x: 595 - 150, y: 0, width: 150, height: 50 })
  })

  it('never takes more than 40 % of a small page', () => {
    const small = { width: 200, height: 100 }
    // Tall image: limited by the page height
    expectBox(initialRect(small, 0.5, { x: 0.5, y: 0.5 }), { x: 90, y: 30, width: 20, height: 40 }, small)
    // Wide image: limited by the page width
    expectBox(initialRect(small, 4, { x: 0.5, y: 0.5 }), { x: 60, y: 40, width: 80, height: 20 }, small)
  })

  it('takes another width for images that are not signature-sized', () => {
    expectBox(initialRect(a4, 6, { x: 0.5, y: 0.5 }, 108), { x: 297.5 - 54, y: 421 - 9, width: 108, height: 18 })
  })
})

describe('moveBy', () => {
  const rect: PlacementRect = { xRatio: 0.4, yRatio: 0.4, widthRatio: 0.2, heightRatio: 0.1 }

  it('moves by page ratios', () => {
    expect(moveBy(rect, 0.1, -0.2)).toEqual({ ...rect, xRatio: 0.5, yRatio: 0.2 })
  })

  it('cannot leave the page or change its size', () => {
    expect(moveBy(rect, 5, 5)).toEqual({ ...rect, xRatio: 0.8, yRatio: 0.9 })
    expect(moveBy(rect, -5, -5)).toEqual({ ...rect, xRatio: 0, yRatio: 0 })
  })

  it('clampToPage keeps an oversized rectangle at the origin', () => {
    expect(clampToPage({ xRatio: 0.5, yRatio: -1, widthRatio: 1.2, heightRatio: 0.5 })).toMatchObject({ xRatio: 0, yRatio: 0 })
  })
})

describe('resizeFromCorner', () => {
  // 150 × 50 at (100, 200)
  const start: PlacementRect = { xRatio: 100 / 595, yRatio: 200 / 842, widthRatio: 150 / 595, heightRatio: 50 / 842 }

  it('grows from the bottom-right corner with the top-left fixed and the aspect ratio kept', () => {
    // 75 points right and 25 down is 1.5× along both axes
    const rect = resizeFromCorner(start, 'se', 75 / 595, 25 / 842, a4)
    expectBox(rect, { x: 100, y: 200, width: 225, height: 75 })
  })

  it('keeps the opposite corner fixed for every corner', () => {
    const grown = { width: 225, height: 75 }
    expectBox(resizeFromCorner(start, 'nw', -75 / 595, -25 / 842, a4), { x: 25, y: 175, ...grown })
    expectBox(resizeFromCorner(start, 'ne', 75 / 595, -25 / 842, a4), { x: 100, y: 175, ...grown })
    expectBox(resizeFromCorner(start, 'sw', -75 / 595, 25 / 842, a4), { x: 25, y: 200, ...grown })
  })

  it('follows the average of both axes', () => {
    // Only horizontal movement: +150 points is 2× in x, 1× in y → 1.5×
    expectBox(resizeFromCorner(start, 'se', 150 / 595, 0, a4), { x: 100, y: 200, width: 225, height: 75 })
  })

  it('stops at the page edge', () => {
    const rect = resizeFromCorner(start, 'se', 5, 5, a4)
    // Width runs out first: 495 points of room from x = 100
    expectBox(rect, { x: 100, y: 200, width: 495, height: 165 })
  })

  it('stops at the minimum size', () => {
    const rect = resizeFromCorner(start, 'se', -5, -5, a4)
    expect(box(rect).height).toBeCloseTo(MIN_SIDE, 6)
    expect(box(rect).width).toBeCloseTo(MIN_SIDE * 3, 6)
  })
})

describe('rectBelow', () => {
  // 150 × 50 at (100, 200)
  const signature: PlacementRect = { xRatio: 100 / 595, yRatio: 200 / 842, widthRatio: 150 / 595, heightRatio: 50 / 842 }

  it('centres the date just under the signature', () => {
    expectBox(rectBelow(signature, a4, 6, 18), { x: 175 - 54, y: 254, width: 108, height: 18 })
  })

  it('goes above when the page ends below the signature', () => {
    const low = { ...signature, yRatio: 780 / 842 }
    expectBox(rectBelow(low, a4, 6, 18), { x: 121, y: 780 - 4 - 18, width: 108, height: 18 })
  })

  it('stays on the page next to a side', () => {
    const left = { ...signature, xRatio: 0, widthRatio: 40 / 595 }
    expect(box(rectBelow(left, a4, 6, 18)).x).toBeCloseTo(0, 6)
  })
})

describe('refitAspect', () => {
  it('keeps the height and centre when the image gets wider', () => {
    // 108 × 18 centred at x = 175
    const date: PlacementRect = { xRatio: 121 / 595, yRatio: 254 / 842, widthRatio: 108 / 595, heightRatio: 18 / 842 }
    expectBox(refitAspect(date, a4, 8), { x: 175 - 72, y: 254, width: 144, height: 18 })
  })

  it('shrinks to the page width', () => {
    const date: PlacementRect = { xRatio: 0, yRatio: 0.5, widthRatio: 0.5, heightRatio: 100 / 842 }
    const rect = refitAspect(date, a4, 10)
    expectBox(rect, { x: 0, y: 421 + 50 - 29.75, width: 595, height: 59.5 })
  })
})
