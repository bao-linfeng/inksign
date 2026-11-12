import type { ImportErrorCode } from '@/services/import-errors'
import type { ImportedPdf } from '@/services/pdf-import'
import { defineStore } from 'pinia'
import { markRaw, nextTick, ref, shallowRef } from 'vue'

import { PdfImportError } from '@/services/import-errors'

let importer: Promise<typeof import('@/services/pdf-import')> | undefined

/** PDF.js and pdf-lib load on demand, never on the home view (PRD §8); a failed download can be retried. */
function loadImporter() {
  importer ??= import('@/services/pdf-import').catch((cause: unknown) => {
    importer = undefined
    throw new PdfImportError('app-load', { cause })
  })
  return importer
}

/** The opened PDF. It lives in memory only and is never persisted (PRD FR-07). */
export const useDocumentStore = defineStore('document', () => {
  const current = shallowRef<ImportedPdf | null>(null)
  /** Increases with every opened document, so per-document view state can be reset */
  const revision = ref(0)
  const loading = ref(false)
  const error = ref<ImportErrorCode | null>(null)

  // Only the latest request may change the state: opening B while A loads discards A
  let latestRequest = 0

  async function release(doc: ImportedPdf | null) {
    if (!doc)
      return
    // Let the pages unmount and cancel their renders before the worker goes away
    await nextTick()
    await doc.pdf.loadingTask.destroy()
  }

  /** Opens `file`, replacing the current document only once the new one has loaded. */
  async function open(file: File): Promise<boolean> {
    const request = ++latestRequest
    loading.value = true
    error.value = null

    let imported: ImportedPdf
    try {
      const { importPdf } = await loadImporter()
      imported = await importPdf(file)
    }
    catch (caught) {
      if (request === latestRequest) {
        error.value = caught instanceof PdfImportError ? caught.code : 'broken'
        loading.value = false
      }
      return false
    }

    if (request !== latestRequest) {
      await imported.pdf.loadingTask.destroy()
      return false
    }
    const previous = current.value
    current.value = markRaw(imported)
    revision.value++
    loading.value = false
    await release(previous)
    return true
  }

  /** Closes the document (and discards an import in progress), back to the home view. */
  async function close() {
    latestRequest++
    const previous = current.value
    current.value = null
    loading.value = false
    error.value = null
    await release(previous)
  }

  function dismissError() {
    error.value = null
  }

  return { current, revision, loading, error, open, close, dismissError }
})
