import type { PlacementRect } from '@/types/signature'
import { describe, expect, it } from 'vitest'

import { anchoredRect, PAGE_RANGE_ERROR, pagesFor, parsePageRange } from '../batch-placement'

const a4 = { width: 595, height: 842 }
const a4Landscape = { width: 842, height: 595 }

function box(rect: PlacementRect, page: { width: number, height: number }) {
  return {
    x: rect.xRatio * page.width,
    y: rect.yRatio * page.height,
    width: rect.widthRatio * page.width,
    height: rect.heightRatio * page.height,
  }
}

function rectOf(x: number, y: number, width: number, height: number, page = a4): PlacementRect {
  return { xRatio: x / page.width, yRatio: y / page.height, widthRatio: width / page.width, heightRatio: height / page.height }
}

function expectBox(rect: PlacementRect, page: { width: number, height: number }, expected: ReturnType<typeof box>) {
  const actual = box(rect, page)
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(actual[key], key).toBeCloseTo(expected[key], 6)
}

describe('parsePageRange', () => {
  it('reads pages and inclusive ranges as sorted zero-based indexes', () => {
    expect(parsePageRange('1-3,5', 10)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('5,1-3,2', 10)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('7', 10)).toEqual([6])
  })

  it('accepts Chinese punctuation and spaces', () => {
    expect(parsePageRange(' 1 - 2 ，4、6~7 ', 10)).toEqual([0, 1, 3, 5, 6])
    expect(parsePageRange('1 3', 10)).toEqual([0, 2])
  })

  it('rejects empty, malformed, reversed or out-of-range input (PRD §9)', () => {
    for (const input of ['', ' , ', 'a', '1-', '-3', '1--3', '3-1', '0', '0-2', '11', '2-11', '1.5'])
      expect(parsePageRange(input, 10), input).toBeNull()
    expect(PAGE_RANGE_ERROR).toBe('页码范围无效，请输入如 1-3,5 的格式，且不超过总页数。')
  })
})

describe('pagesFor', () => {
  it('covers the page choices of FR-10', () => {
    expect(pagesFor('all', 4)).toEqual([0, 1, 2, 3])
    expect(pagesFor('all-but-last', 4)).toEqual([0, 1, 2])
    expect(pagesFor('last', 4)).toEqual([3])
    expect(pagesFor('custom', 4, '2-3')).toEqual([1, 2])
    expect(pagesFor('custom', 4, '9')).toBeNull()
  })

  it('has nothing but the page itself in a single-page document', () => {
    expect(pagesFor('all-but-last', 1)).toEqual([])
    expect(pagesFor('last', 1)).toEqual([0])
  })
})

describe('anchoredRect', () => {
  it('copies to a page of the same size unchanged', () => {
    const rect = rectOf(400, 700, 150, 50)
    expectBox(anchoredRect(rect, a4, a4), a4, { x: 400, y: 700, width: 150, height: 50 })
  })

  it('keeps the margins to the nearest corner and the absolute size on another page size', () => {
    // Bottom right: 45 points from the right edge, 92 from the bottom
    expectBox(anchoredRect(rectOf(400, 700, 150, 50), a4, a4Landscape), a4Landscape, { x: 842 - 45 - 150, y: 595 - 92 - 50, width: 150, height: 50 })
    // Top left: margins measured from the top-left corner
    expectBox(anchoredRect(rectOf(30, 40, 150, 50), a4, a4Landscape), a4Landscape, { x: 30, y: 40, width: 150, height: 50 })
    // Top right
    expectBox(anchoredRect(rectOf(420, 40, 150, 50), a4, a4Landscape), a4Landscape, { x: 842 - 25 - 150, y: 40, width: 150, height: 50 })
    // Bottom left
    expectBox(anchoredRect(rectOf(30, 760, 150, 50), a4, a4Landscape), a4Landscape, { x: 30, y: 595 - 32 - 50, width: 150, height: 50 })
  })

  it('scales down to fit a smaller page and stays on it', () => {
    const small = { width: 100, height: 300 }
    expectBox(anchoredRect(rectOf(400, 700, 150, 50), a4, small), small, { x: 0, y: 300 - 92 - 100 / 3, width: 100, height: 100 / 3 })
  })

  it('clamps when the margin would push the copy off the page', () => {
    const short = { width: 595, height: 120 }
    // 60 points from the top on A4, but only 120 points of height here
    expectBox(anchoredRect(rectOf(30, 60, 150, 80), a4, short), short, { x: 30, y: 40, width: 150, height: 80 })
  })
})
