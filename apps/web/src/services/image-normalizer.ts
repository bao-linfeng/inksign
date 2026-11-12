import type { SignatureImage } from './signature-image'

import { canvasToPng, fitWithin, trimCanvas } from './signature-image'

/** PRD FR-04 limits */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const IMAGE_MAX_SIDE = 2000
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export const IMAGE_ERROR_MESSAGE = '图片无法使用，请上传 10 MB 以内的 PNG、JPG 或 WebP 图片。'

export class ImageNormalizeError extends Error {
  constructor(options?: ErrorOptions) {
    super('Image cannot be used as a signature', options)
    this.name = 'ImageNormalizeError'
  }
}

/** Whether a file may be decoded at all; the decoder has the final say. */
export function isAcceptedImage(file: File) {
  // Some systems report no type; let the decoder decide then
  return file.size > 0 && file.size <= IMAGE_MAX_BYTES && (file.type === '' || ACCEPTED_TYPES.includes(file.type))
}

/**
 * Turns an uploaded PNG, JPG or WebP into PNG bytes (PRD FR-04): applies the EXIF orientation,
 * shrinks the longer side to 2000 px and drops fully transparent margins. JPG backgrounds stay
 * as they are; nothing is made transparent.
 */
export async function normalizeImage(file: File): Promise<SignatureImage> {
  if (!isAcceptedImage(file))
    throw new ImageNormalizeError()

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  }
  catch (error) {
    throw new ImageNormalizeError({ cause: error })
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context)
      throw new ImageNormalizeError()
    context.drawImage(bitmap, 0, 0, width, height)
    const trimmed = trimCanvas(canvas, 0)
    if (!trimmed)
      throw new ImageNormalizeError()
    return { pngBytes: await canvasToPng(trimmed), width: trimmed.width, height: trimmed.height }
  }
  finally {
    bitmap.close()
  }
}
