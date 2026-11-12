import type { ImportedPdf } from '@/services/pdf-import'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PdfImportError } from '@/services/import-errors'
import { importPdf } from '@/services/pdf-import'

import { useDocumentStore } from '../document'

vi.mock('@/services/pdf-import', () => ({ importPdf: vi.fn() }))

function fakeImport(fileName: string) {
  const destroy = vi.fn(async () => {})
  const imported = {
    fileName,
    bytes: new Uint8Array(),
    pdf: { loadingTask: { destroy } },
    pages: [],
    signatures: { signedFields: 0 },
  } as unknown as ImportedPdf
  return { imported, destroy }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const file = (name: string) => new File(['%PDF-'], name)

describe('document store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(importPdf).mockReset()
  })

  it('opens a PDF', async () => {
    const { imported } = fakeImport('a.pdf')
    vi.mocked(importPdf).mockResolvedValue(imported)
    const store = useDocumentStore()

    const opening = store.open(file('a.pdf'))
    expect(store.loading).toBe(true)

    expect(await opening).toBe(true)
    expect(store.current?.fileName).toBe('a.pdf')
    expect(store.revision).toBe(1)
    expect(store.loading).toBe(false)
  })

  it('reports why a file could not be opened and keeps the current one', async () => {
    const { imported, destroy } = fakeImport('a.pdf')
    vi.mocked(importPdf).mockResolvedValueOnce(imported).mockRejectedValueOnce(new PdfImportError('password'))
    const store = useDocumentStore()
    await store.open(file('a.pdf'))

    expect(await store.open(file('locked.pdf'))).toBe(false)
    expect(store.error).toBe('password')
    expect(store.current?.fileName).toBe('a.pdf')
    expect(destroy).not.toHaveBeenCalled()

    store.dismissError()
    expect(store.error).toBeNull()
  })

  it('treats unexpected failures as an unreadable file', async () => {
    vi.mocked(importPdf).mockRejectedValue(new DOMException('gone', 'NotReadableError'))
    const store = useDocumentStore()

    await store.open(file('a.pdf'))

    expect(store.error).toBe('broken')
  })

  it('releases the previous document when another one replaces it', async () => {
    const first = fakeImport('a.pdf')
    const second = fakeImport('b.pdf')
    vi.mocked(importPdf).mockResolvedValueOnce(first.imported).mockResolvedValueOnce(second.imported)
    const store = useDocumentStore()

    await store.open(file('a.pdf'))
    await store.open(file('b.pdf'))

    expect(store.current?.fileName).toBe('b.pdf')
    expect(store.revision).toBe(2)
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(second.destroy).not.toHaveBeenCalled()
  })

  it('keeps only the file chosen last when imports overlap', async () => {
    const slow = deferred<ImportedPdf>()
    const first = fakeImport('slow.pdf')
    const second = fakeImport('fast.pdf')
    vi.mocked(importPdf).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(second.imported)
    const store = useDocumentStore()

    const opening = store.open(file('slow.pdf'))
    await store.open(file('fast.pdf'))
    slow.resolve(first.imported)

    expect(await opening).toBe(false)
    expect(store.current?.fileName).toBe('fast.pdf')
    expect(first.destroy).toHaveBeenCalledOnce()
  })

  it('closes the document and discards an import in progress', async () => {
    const opened = fakeImport('a.pdf')
    const pending = deferred<ImportedPdf>()
    const late = fakeImport('late.pdf')
    vi.mocked(importPdf).mockResolvedValueOnce(opened.imported).mockReturnValueOnce(pending.promise)
    const store = useDocumentStore()
    await store.open(file('a.pdf'))

    const opening = store.open(file('late.pdf'))
    await store.close()
    pending.resolve(late.imported)
    await opening

    expect(store.current).toBeNull()
    expect(store.loading).toBe(false)
    expect(opened.destroy).toHaveBeenCalledOnce()
    expect(late.destroy).toHaveBeenCalledOnce()
  })
})
