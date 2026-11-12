import { CSS_PX_PER_POINT } from './pdf-renderer'

/** 25 % lets an A4 page fit a phone screen; past 300 % the canvas budget lowers sharpness anyway. */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3

const STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]

/** Tolerance so a zoom like 0.9999 from fit-width still counts as the 100 % step */
const EPSILON = 1e-3

export function clampZoom(zoom: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** Next larger step, also from a zoom between steps (e.g. after fit-width). */
export function zoomIn(zoom: number) {
  return STEPS.find(step => step > zoom + EPSILON) ?? ZOOM_MAX
}

export function zoomOut(zoom: number) {
  // Array.prototype.findLast is ES2023, missing in the older Safari the app still supports
  return [...STEPS].reverse().find(step => step < zoom - EPSILON) ?? ZOOM_MIN
}

/** Zoom at which the widest page (widths at PDF.js scale 1) fills `availableWidth` CSS pixels. */
export function fitWidthZoom(availableWidth: number, pageWidths: readonly number[]) {
  const widest = Math.max(...pageWidths)
  if (!(availableWidth > 0) || !(widest > 0))
    return 1
  return clampZoom(availableWidth / (widest * CSS_PX_PER_POINT))
}

/** Initial zoom: fit the width, but not beyond 100 % on wide screens. */
export function initialZoom(availableWidth: number, pageWidths: readonly number[]) {
  return Math.min(1, fitWidthZoom(availableWidth, pageWidths))
}
