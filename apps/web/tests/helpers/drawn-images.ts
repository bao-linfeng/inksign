import type { PageGeometry } from '@/services/coordinate-transform'
import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

import { pageGeometryOf } from '@/services/coordinate-transform'

type Matrix = [number, number, number, number, number, number]
type Point = [number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `m1 ∘ m2`: applies `m2` first, like PDF.js `Util.transform`. */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Corners of a drawn image on the visible page, as ratios of its width and height (top-left origin). */
export interface DrawnImage {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

export interface InspectedPage {
  geometry: PageGeometry
  /** PDF.js viewport at scale 1, to compare against its own `convertToPdfPoint` */
  viewport: pdfjs.PageViewport
  images: DrawnImage[]
  /** `cm` operators outside any `q … Q`; they change the CTM for everything drawn after them */
  unscopedTransforms: number
}

/**
 * Replays each page's operator list with PDF.js and reports where every image XObject lands on the
 * visible page. Independent of the code under test: it relies only on PDF.js parsing and its viewport.
 */
export async function inspectPages(pdfBytes: Uint8Array): Promise<InspectedPage[]> {
  const task = pdfjs.getDocument({ data: pdfBytes.slice() })
  try {
    const doc = await task.promise
    const pages: InspectedPage[] = []
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const toVisible = viewport.transform as Matrix
      const { fnArray, argsArray } = await page.getOperatorList()

      const images: DrawnImage[] = []
      const stack: Matrix[] = []
      let ctm = IDENTITY
      let unscopedTransforms = 0
      fnArray.forEach((fn, index) => {
        if (fn === pdfjs.OPS.save) {
          stack.push(ctm)
        }
        else if (fn === pdfjs.OPS.restore) {
          ctm = stack.pop() ?? IDENTITY
        }
        else if (fn === pdfjs.OPS.transform) {
          ctm = multiply(ctm, Array.from(argsArray[index] as ArrayLike<number>) as Matrix)
          if (stack.length === 0)
            unscopedTransforms++
        }
        else if (fn === pdfjs.OPS.paintImageXObject) {
          // Image space is the unit square with (0, 0) at the image's bottom-left corner
          const corner = (point: Point): Point => {
            const [x, y] = apply(toVisible, apply(ctm, point))
            return [x / viewport.width, y / viewport.height]
          }
          images.push({ topLeft: corner([0, 1]), topRight: corner([1, 1]), bottomLeft: corner([0, 0]), bottomRight: corner([1, 0]) })
        }
      })

      pages.push({ geometry: pageGeometryOf(page), viewport, images, unscopedTransforms })
    }
    return pages
  }
  finally {
    await task.destroy()
  }
}

/** Counts image XObjects (an image with transparency counts twice: image + soft mask). */
export async function countImageObjects(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes)
  return doc.context.enumerateIndirectObjects().filter(([, object]) =>
    object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
  ).length
}
