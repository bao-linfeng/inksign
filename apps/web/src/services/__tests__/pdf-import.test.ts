import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import type { ImportErrorCode } from '../import-errors'
import type { ImportLimits } from '../pdf-import'
import { describe, expect, it, vi } from 'vitest'

import { encryptedFixtures, pdfFixtures } from '../../../tests/fixtures/pdf-fixtures'
import { createSignedPdf, hasOpenssl } from '../../../tests/helpers/signed-pdf'
import { importErrorMessages, PdfImportError } from '../import-errors'
import { importLimits, importPdf } from '../pdf-import'
import { openPdf } from '../pdfjs'

// The app's worker URL is a Vite asset URL; in Node PDF.js runs its worker in-process instead
vi.mock('../pdfjs', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return { openPdf: vi.fn((bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice() })) }
})

const fixture = (name: string) => pdfFixtures.find(f => f.name === name)!.build()
// pdf-lib returns Uint8Array<ArrayBufferLike>, which TypeScript does not accept as a BlobPart
const pdfFile = (bytes: Uint8Array | string, name = 'contract.pdf', type = 'application/pdf') => new File([bytes as BlobPart], name, { type })

async function importError(file: File, limits?: ImportLimits): Promise<ImportErrorCode> {
  const error = await importPdf(file, limits).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(PdfImportError)
  return (error as PdfImportError).code
}

function lastLoadingTask(): PDFDocumentLoadingTask {
  return vi.mocked(openPdf).mock.results.at(-1)!.value
}

describe('importPdf', () => {
  it('keeps the original bytes and reports every page as PDF.js shows it', async () => {
    const original = await fixture('mixed-pages')
    const imported = await importPdf(pdfFile(original))

    expect(imported.fileName).toBe('contract.pdf')
    expect(imported.bytes).toEqual(original)
    expect(imported.pdf.numPages).toBe(3)
    expect(imported.signatures).toEqual({ signedFields: 0, certification: undefined })
    expect(imported.pages.map(({ width, height, geometry }) => [Math.round(width), Math.round(height), geometry.rotation]))
      .toEqual([[595, 842, 0], [842, 595, 0], [792, 612, 90]])
    await imported.pdf.loadingTask.destroy()
  })

  it('sizes pages with /UserUnit like the preview does', async () => {
    const imported = await importPdf(pdfFile(await fixture('user-unit-2')))

    expect(imported.pages[0]).toMatchObject({ width: 600, height: 840, geometry: { view: [0, 0, 300, 420] } })
    await imported.pdf.loadingTask.destroy()
  })

  it('opens damaged files that both PDF libraries can repair', async () => {
    const imported = await importPdf(pdfFile(await fixture('broken-xref')))

    expect(imported.pages).toHaveLength(1)
    await imported.pdf.loadingTask.destroy()
  })

  it('checks the content, not the file name or type', async () => {
    expect(await importError(pdfFile(''))).toBe('empty')
    expect(await importError(pdfFile('<html>not a pdf</html>'))).toBe('not-pdf')
  })

  it('accepts a PDF whatever it is called', async () => {
    const imported = await importPdf(pdfFile(await fixture('a4-portrait'), 'scan.png', 'image/png'))

    expect(imported.pages).toHaveLength(1)
    await imported.pdf.loadingTask.destroy()
  })

  it('refuses a file that is not a readable PDF', async () => {
    expect(await importError(pdfFile('%PDF-1.7\nthis is not really a PDF'))).toBe('broken')
    expect(lastLoadingTask().destroyed).toBe(true)
  })

  it('enforces the size and page limits', async () => {
    const original = await fixture('mixed-pages')

    expect(await importError(pdfFile(original), { ...importLimits, maxBytes: original.length - 1 })).toBe('too-large')
    expect(await importError(pdfFile(original), { ...importLimits, maxPages: 2 })).toBe('too-many-pages')
    expect(lastLoadingTask().destroyed).toBe(true)
  })

  it('tells an open password apart from editing restrictions', async () => {
    expect(await importError(pdfFile(await encryptedFixtures.openPassword()))).toBe('password')
    expect(await importError(pdfFile(await encryptedFixtures.ownerPassword()))).toBe('restricted')
    expect(lastLoadingTask().destroyed).toBe(true)
  })

  it.runIf(hasOpenssl())('reports existing digital signatures', async () => {
    const imported = await importPdf(pdfFile(await createSignedPdf({ certify: 2 })))

    expect(imported.signatures).toEqual({ signedFields: 1, certification: 2 })
    await imported.pdf.loadingTask.destroy()
  })

  it('has a message for every error', () => {
    for (const message of Object.values(importErrorMessages))
      expect(message).toMatch(/。$/)
  })
})
