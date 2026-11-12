/** Pixel box in an image */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Bounding box of the pixels that are not fully transparent, or `null` for a blank image. */
export function alphaBounds(rgba: Uint8ClampedArray, width: number, height: number): Bounds | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0)
        continue
      if (x < left)
        left = x
      if (x > right)
        right = x
      if (y < top)
        top = y
      if (y > bottom)
        bottom = y
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** Grows `bounds` by `padding` pixels on each side, within the image. */
export function padBounds(bounds: Bounds, padding: number, width: number, height: number): Bounds {
  const x = Math.max(0, bounds.x - padding)
  const y = Math.max(0, bounds.y - padding)
  return {
    x,
    y,
    width: Math.min(width, bounds.x + bounds.width + padding) - x,
    height: Math.min(height, bounds.y + bounds.height + padding) - y,
  }
}

/** Scales a size down (never up) so its longer side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Copies the non-transparent part of `canvas` plus `padding` pixels into a new canvas (PRD FR-03,
 * §4.3: transparent margins go, strokes stay). Returns `null` when nothing was drawn.
 */
export function trimCanvas(canvas: HTMLCanvasElement, padding: number): HTMLCanvasElement | null {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context)
    return null
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const bounds = alphaBounds(data, canvas.width, canvas.height)
  if (!bounds)
    return null
  const box = padBounds(bounds, padding, canvas.width, canvas.height)
  const trimmed = document.createElement('canvas')
  trimmed.width = box.width
  trimmed.height = box.height
  trimmed.getContext('2d')!.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
  return trimmed
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob)
    throw new Error('Canvas could not be encoded as PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

/** A signature image ready to be placed: transparent PNG bytes and their pixel size. */
export interface SignatureImage {
  pngBytes: Uint8Array
  width: number
  height: number
}
