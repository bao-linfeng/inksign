import type { PlacementRect } from '@/types/signature'
import { describe, expect, it } from 'vitest'

import { clampToPage, initialRect, MIN_SIDE, moveBy, resizeFromCorner } from '../placement'

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
