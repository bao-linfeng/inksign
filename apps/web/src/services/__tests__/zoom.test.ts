import { describe, expect, it } from 'vitest'

import { CSS_PX_PER_POINT } from '../pdf-renderer'
import { clampZoom, fitWidthZoom, initialZoom, ZOOM_MAX, ZOOM_MIN, zoomIn, zoomOut } from '../zoom'

describe('zoom', () => {
  it('steps through fixed levels, also from in between', () => {
    expect(zoomIn(1)).toBe(1.25)
    expect(zoomOut(1)).toBe(0.75)
    expect(zoomIn(0.8)).toBe(1)
    expect(zoomOut(0.8)).toBe(0.75)
    // A fit-width result that is 100 % up to rounding counts as 100 %
    expect(zoomIn(0.9999)).toBe(1.25)
    expect(zoomOut(1.0001)).toBe(0.75)
  })

  it('stays within its limits', () => {
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX)
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN)
    expect(clampZoom(10)).toBe(ZOOM_MAX)
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
  })

  it('fits the widest page into the available width', () => {
    const widths = [595, 842]

    expect(fitWidthZoom(842 * CSS_PX_PER_POINT, widths)).toBeCloseTo(1)
    expect(fitWidthZoom(421 * CSS_PX_PER_POINT, widths)).toBeCloseTo(0.5)
    expect(fitWidthZoom(0, widths)).toBe(1)
    expect(fitWidthZoom(800, [])).toBe(1)
  })

  it('starts at fit-width, but not beyond 100 %', () => {
    expect(initialZoom(4000, [595])).toBe(1)
    expect(initialZoom(343, [595])).toBeCloseTo(343 / (595 * CSS_PX_PER_POINT))
  })
})
