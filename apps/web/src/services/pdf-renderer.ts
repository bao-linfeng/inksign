import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'

/** Browsers and PDF.js show "100 %" at 96 CSS pixels per inch; a PDF point is 1/72 inch. */
export const CSS_PX_PER_POINT = 96 / 72

/**
 * Pixel budget of one page canvas (PRD FR-02). iOS Safari refuses larger canvases, and each
 * rendered page holds 4 bytes per pixel, so high zoom on a dense screen drops resolution instead.
 */
export const MAX_CANVAS_PIXELS = 4096 * 4096

export interface RenderPlan {
  /** Displayed size of the page */
  cssWidth: number
  cssHeight: number
  /** PDF.js viewport scale matching the displayed size */
  cssScale: number
  /** Canvas backing store size */
  pixelWidth: number
  pixelHeight: number
}

/**
 * Sizes a page for `zoom` (1 = 100 %): rendered at the device pixel ratio for sharp text on
 * high-DPI screens, but never above `maxPixels`.
 */
export function planRender(
  page: { width: number, height: number },
  zoom: number,
  devicePixelRatio: number,
  maxPixels = MAX_CANVAS_PIXELS,
): RenderPlan {
  const cssScale = zoom * CSS_PX_PER_POINT
  const cssWidth = page.width * cssScale
  const cssHeight = page.height * cssScale
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1
  const outputScale = Math.min(ratio, Math.sqrt(maxPixels / (cssWidth * cssHeight)))
  return {
    cssWidth,
    cssHeight,
    cssScale,
    pixelWidth: Math.max(1, Math.floor(cssWidth * outputScale)),
    pixelHeight: Math.max(1, Math.floor(cssHeight * outputScale)),
  }
}

/** Renders a page into a new canvas, so the previous one stays on screen until this one is ready. */
export function renderToCanvas(page: PDFPageProxy, plan: RenderPlan): { canvas: HTMLCanvasElement, task: RenderTask } {
  const canvas = document.createElement('canvas')
  canvas.width = plan.pixelWidth
  canvas.height = plan.pixelHeight
  const task = page.render({
    canvas,
    viewport: page.getViewport({ scale: plan.cssScale }),
    transform: [plan.pixelWidth / plan.cssWidth, 0, 0, plan.pixelHeight / plan.cssHeight, 0, 0],
  })
  return { canvas, task }
}

export function isRenderingCancelled(error: unknown) {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}
