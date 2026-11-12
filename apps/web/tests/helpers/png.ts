import { crc32, deflateSync } from 'node:zlib'

type Rgba = readonly [number, number, number, number]

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Minimal RGBA PNG encoder for tests (Node has no canvas). */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA, no interlace

  const rowLength = 1 + width * 4 // leading byte: filter type 0
  const rows = new Uint8Array(height * rowLength)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      rows.set(pixel(x, y), y * rowLength + 1 + x * 4)
  }

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

const INK: Rgba = [30, 58, 95, 255]
const CLEAR: Rgba = [0, 0, 0, 0]

/**
 * A transparent "signature" with a frame and an upward arrow, so a rotated or mirrored export is
 * obvious when the sample PDFs are opened in a viewer.
 */
export function arrowSignaturePng(width = 120, height = 60): Uint8Array {
  const cx = width / 2
  return encodePng(width, height, (x, y) => {
    const frame = x < 2 || y < 2 || x >= width - 2 || y >= height - 2
    const head = y >= 8 && y < height / 2 && Math.abs(x - cx) <= (y - 8) * 0.8
    const stem = y >= height / 2 && y < height - 8 && Math.abs(x - cx) <= 4
    return frame || head || stem ? INK : CLEAR
  })
}
