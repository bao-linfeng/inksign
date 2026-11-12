import { describe, expect, it } from 'vitest'

import { signedFileName } from '../download'
import { IMAGE_MAX_BYTES, isAcceptedImage } from '../image-normalizer'
import { alphaBounds, fitWithin, padBounds } from '../signature-image'

/** RGBA pixels of a `width` × `height` image with the listed pixels opaque */
function image(width: number, height: number, opaque: Array<[number, number]>) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of opaque)
    rgba[(y * width + x) * 4 + 3] = 255
  return rgba
}

describe('alphaBounds', () => {
  it('finds the box around every visible pixel', () => {
    expect(alphaBounds(image(10, 8, [[2, 3], [7, 5], [4, 1]]), 10, 8)).toEqual({ x: 2, y: 1, width: 6, height: 5 })
  })

  it('counts faint anti-aliased pixels as ink', () => {
    const rgba = image(4, 4, [])
    rgba[(1 * 4 + 2) * 4 + 3] = 1
    expect(alphaBounds(rgba, 4, 4)).toEqual({ x: 2, y: 1, width: 1, height: 1 })
  })

  it('reports a blank image', () => {
    expect(alphaBounds(image(5, 5, []), 5, 5)).toBeNull()
  })
})

describe('padBounds', () => {
  it('adds padding without leaving the image', () => {
    expect(padBounds({ x: 10, y: 10, width: 20, height: 5 }, 8, 100, 100)).toEqual({ x: 2, y: 2, width: 36, height: 21 })
    expect(padBounds({ x: 2, y: 90, width: 20, height: 8 }, 8, 100, 100)).toEqual({ x: 0, y: 82, width: 30, height: 18 })
  })
})

describe('fitWithin', () => {
  it('shrinks the longer side to the limit and never enlarges', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(1000, 3000, 2000)).toEqual({ width: 667, height: 2000 })
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 })
  })
})

describe('isAcceptedImage', () => {
  const file = (size: number, type: string) => new File([new Uint8Array(size)], 'sig', { type })

  it('accepts PNG, JPG and WebP up to 10 MB (PRD FR-04)', () => {
    expect(isAcceptedImage(file(10, 'image/png'))).toBe(true)
    expect(isAcceptedImage(file(10, 'image/jpeg'))).toBe(true)
    expect(isAcceptedImage(file(10, 'image/webp'))).toBe(true)
    expect(isAcceptedImage(file(IMAGE_MAX_BYTES + 1, 'image/png'))).toBe(false)
    expect(isAcceptedImage(file(0, 'image/png'))).toBe(false)
  })

  it('rejects other types but lets the decoder judge untyped files', () => {
    expect(isAcceptedImage(file(10, 'image/gif'))).toBe(false)
    expect(isAcceptedImage(file(10, 'application/pdf'))).toBe(false)
    expect(isAcceptedImage(file(10, ''))).toBe(true)
  })
})

describe('signedFileName', () => {
  it('appends _signed before the extension (PRD FR-06)', () => {
    expect(signedFileName('服务合同.pdf')).toBe('服务合同_signed.pdf')
    expect(signedFileName('Contract.PDF')).toBe('Contract_signed.pdf')
    expect(signedFileName('scan')).toBe('scan_signed.pdf')
    expect(signedFileName('.pdf')).toBe('document_signed.pdf')
  })
})
