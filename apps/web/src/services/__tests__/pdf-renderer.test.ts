import { describe, expect, it } from 'vitest'

import { CSS_PX_PER_POINT, MAX_CANVAS_PIXELS, planRender } from '../pdf-renderer'

const a4 = { width: 595.28, height: 841.89 }

describe('planRender', () => {
  it('shows 100 % at 96 CSS pixels per inch', () => {
    const plan = planRender(a4, 1, 1)

    expect(plan.cssScale).toBeCloseTo(CSS_PX_PER_POINT)
    expect(plan.cssWidth).toBeCloseTo(793.71, 2)
    expect(plan.cssHeight).toBeCloseTo(1122.52, 2)
    expect([plan.pixelWidth, plan.pixelHeight]).toEqual([793, 1122])
  })

  it('renders at the device pixel ratio for sharp text on high-DPI screens', () => {
    const plan = planRender(a4, 0.5, 3)

    expect(plan.cssWidth).toBeCloseTo(396.85, 2)
    expect([plan.pixelWidth, plan.pixelHeight]).toEqual([1190, 1683])
  })

  it('caps the canvas size and keeps the page proportions', () => {
    const plan = planRender(a4, 3, 3)

    expect(plan.pixelWidth * plan.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(plan.pixelWidth / plan.pixelHeight).toBeCloseTo(a4.width / a4.height, 3)
    // The displayed size does not depend on the cap
    expect(plan.cssWidth).toBeCloseTo(a4.width * 3 * CSS_PX_PER_POINT)
  })

  it('treats a missing device pixel ratio as 1', () => {
    expect(planRender(a4, 1, 0).pixelWidth).toBe(793)
  })
})
