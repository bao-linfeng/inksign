import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageGeometry } from './coordinate-transform'
import type { DigitalSignatureInfo } from './pdf-inspector'
import { EncryptedPDFError, PDFDocument } from '@cantoo/pdf-lib'

import { pageGeometryOf } from './coordinate-transform'
import { PdfImportError } from './import-errors'
import { describeDigitalSignatures, hasPdfHeader } from './pdf-inspector'
import { openPdf } from './pdfjs'

/** Default limits from PRD FR-01; past them the import is refused instead of risking a crash. */
export const importLimits = { maxBytes: 50 * 1024 * 1024, maxPages: 200 }

export type ImportLimits = typeof importLimits

export interface PreviewPage {
  geometry: PageGeometry
  /** Visible size at PDF.js scale 1 (points × /UserUnit, rotation applied) */
  width: number
  height: number
}

export interface ImportedPdf {
  fileName: string
  /** The untouched file, kept in memory for every export (PRD §7) */
  bytes: Uint8Array
  /** Preview document; `pdf.loadingTask.destroy()` releases it */
  pdf: PDFDocumentProxy
  pages: PreviewPage[]
  signatures: DigitalSignatureInfo
}

function isPasswordError(error: unknown) {
  return error instanceof Error && error.name === 'PasswordException'
}

/**
 * The export library must accept the file too, otherwise signing would only fail at export (PRD
 * FR-01). PDF.js opened it without a password, so encryption here means owner-password restrictions.
 */
async function inspectForExport(bytes: Uint8Array) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, forIncrementalUpdate: true })
    return describeDigitalSignatures(doc)
  }
  catch (error) {
    throw new PdfImportError(error instanceof EncryptedPDFError ? 'restricted' : 'broken', { cause: error })
  }
}

/** Reads and checks a PDF chosen by the user, entirely in memory (PRD FR-01). */
export async function importPdf(file: File, limits: ImportLimits = importLimits): Promise<ImportedPdf> {
  if (file.size === 0)
    throw new PdfImportError('empty')
  if (file.size > limits.maxBytes)
    throw new PdfImportError('too-large')

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!hasPdfHeader(bytes))
    throw new PdfImportError('not-pdf')

  const task = openPdf(bytes)
  try {
    let pdf: PDFDocumentProxy
    try {
      pdf = await task.promise
    }
    catch (error) {
      throw new PdfImportError(isPasswordError(error) ? 'password' : 'broken', { cause: error })
    }
    if (pdf.numPages > limits.maxPages)
      throw new PdfImportError('too-many-pages')

    const signatures = await inspectForExport(bytes)
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1)
      const { width, height } = page.getViewport({ scale: 1 })
      return { geometry: pageGeometryOf(page), width, height }
    }))
    return { fileName: file.name, bytes, pdf, pages, signatures }
  }
  catch (error) {
    await task.destroy()
    throw error instanceof PdfImportError ? error : new PdfImportError('broken', { cause: error })
  }
}
