import { describe, expect, it } from 'vitest'

import { pdfFixtures } from '../../../tests/fixtures/pdf-fixtures'
import { inspectPages } from '../../../tests/helpers/drawn-images'
import { normalizeRotation, placementToDrawParams, visibleSize, visibleToPdfPoint } from '../coordinate-transform'

describe('normalizeRotation', () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-180, 180],
    [45, 0],
    [90.5, 0],
  ])('%d° → %d°', (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected)
  })
})

describe('visibleToPdfPoint', () => {
  // The reference is PDF.js itself: the preview is rendered through its viewport, so the export must
  // invert exactly that mapping, for every fixture page (rotations, offset boxes, UserUnit).
  describe.each(pdfFixtures)('$name', (fixture) => {
    it('matches PDF.js viewport.convertToPdfPoint', async () => {
      for (const { geometry, viewport } of await inspectPages(await fixture.build())) {
        const size = visibleSize(geometry)
        // PDF.js viewport units include /UserUnit; ours are plain user-space units
        const scale = viewport.width / size.width
        expect(viewport.height / size.height).toBeCloseTo(scale, 9)

        for (const [vx, vy] of [[0, 0], [size.width, 0], [0, size.height], [size.width * 0.3, size.height * 0.7]] as const) {
          const [px, py] = visibleToPdfPoint(geometry, vx, vy)
          const [ex, ey] = viewport.convertToPdfPoint(vx * scale, vy * scale)
          expect(px).toBeCloseTo(ex, 6)
          expect(py).toBeCloseTo(ey, 6)
        }
      }
    })
  })
})

describe('placementToDrawParams', () => {
  const rect = { xRatio: 0.5, yRatio: 0.25, widthRatio: 0.2, heightRatio: 0.1 }

  it('anchors at the visual bottom-left corner on an unrotated page', () => {
    // 200 × 400 page: the rect spans x 100..140, y 100..140 from the top
    expect(placementToDrawParams({ view: [0, 0, 200, 400], rotation: 0 }, rect)).toEqual({
      x: 100,
      y: 260,
      width: 40,
      height: 40,
      rotation: 0,
    })
  })

  it('keeps visible width and height and turns the image with the page', () => {
    // Same MediaBox shown landscape (400 × 200): rect is 80 × 20 at (200, 50) from the top-left
    const params = placementToDrawParams({ view: [0, 0, 200, 400], rotation: 90 }, rect)
    expect(params).toEqual({ x: 70, y: 200, width: 80, height: 20, rotation: 90 })
  })
})
