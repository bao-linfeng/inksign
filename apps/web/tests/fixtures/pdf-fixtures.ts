import type { PDFPage } from '@cantoo/pdf-lib'
import {
  concatTransformationMatrix,
  degrees,
  PageSizes,
  PDFDocument,
  PDFName,
  PDFNumber,
  rgb,
  StandardFonts,
} from '@cantoo/pdf-lib'

export interface PdfFixture {
  name: string
  /** What the fixture exercises (PRD §10 cases 3-5 and known PDF quirks) */
  description: string
  build: () => Promise<Uint8Array>
}

/** Frames and labels the page in raw user space, so its rotation shows when the file is opened. */
async function label(doc: PDFDocument, page: PDFPage, text: string) {
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const { x, y, width, height } = page.getCropBox()
  page.drawRectangle({ x: x + 10, y: y + 10, width: width - 20, height: height - 20, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 })
  page.drawText(text, { x: x + 24, y: y + height - 40, size: 14, font, color: rgb(0.3, 0.3, 0.3) })
}

function single(name: string, description: string, setup: (doc: PDFDocument) => PDFPage): PdfFixture {
  return {
    name,
    description,
    async build() {
      const doc = await PDFDocument.create()
      const page = setup(doc)
      await label(doc, page, name)
      return doc.save()
    },
  }
}

export const pdfFixtures: PdfFixture[] = [
  single('a4-portrait', 'Plain A4 portrait page', doc => doc.addPage(PageSizes.A4)),
  ...([90, 180, 270] as const).map(rotation =>
    single(`rotate-${rotation}`, `A4 page with /Rotate ${rotation}`, (doc) => {
      const page = doc.addPage(PageSizes.A4)
      page.setRotation(degrees(rotation))
      return page
    }),
  ),
  single('rotate-minus-90', '/Rotate -90, which viewers treat as 270', (doc) => {
    const page = doc.addPage(PageSizes.A4)
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(-90))
    return page
  }),
  single('inherited-rotate', '/Rotate 90 on the page tree root, inherited by the page', (doc) => {
    const page = doc.addPage(PageSizes.A4)
    doc.catalog.Pages().set(PDFName.of('Rotate'), PDFNumber.of(90))
    return page
  }),
  single('cropbox-offset', 'CropBox that does not start at the origin', (doc) => {
    const page = doc.addPage([600, 800])
    page.setCropBox(60, 90, 400, 500)
    return page
  }),
  single('cropbox-offset-rotate-90', 'Offset CropBox combined with /Rotate 90', (doc) => {
    const page = doc.addPage([600, 800])
    page.setCropBox(60, 90, 400, 500)
    page.setRotation(degrees(90))
    return page
  }),
  single('mediabox-offset', 'MediaBox that does not start at the origin', (doc) => {
    const page = doc.addPage(PageSizes.A4)
    page.setMediaBox(100, 100, 595.28, 841.89)
    return page
  }),
  single('user-unit-2', '/UserUnit 2 (PDF.js scales the viewport by it)', (doc) => {
    const page = doc.addPage([300, 420])
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2))
    return page
  }),
  single('dirty-ctm', 'Content that ends with an unbalanced cm, leaking a scale into later content', (doc) => {
    const page = doc.addPage(PageSizes.A4)
    page.pushOperators(concatTransformationMatrix(0.5, 0, 0, 0.5, 0, 0))
    return page
  }),
  {
    name: 'mixed-pages',
    description: 'Portrait, landscape and rotated Letter pages in one document',
    async build() {
      const doc = await PDFDocument.create()
      await label(doc, doc.addPage(PageSizes.A4), 'mixed-pages 1: A4 portrait')
      await label(doc, doc.addPage([PageSizes.A4[1], PageSizes.A4[0]]), 'mixed-pages 2: A4 landscape')
      const letter = doc.addPage(PageSizes.Letter)
      letter.setRotation(degrees(90))
      await label(doc, letter, 'mixed-pages 3: Letter, /Rotate 90')
      return doc.save()
    },
  },
]
