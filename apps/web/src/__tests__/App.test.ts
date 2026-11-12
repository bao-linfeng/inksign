// @vitest-environment happy-dom
import type { ImportedPdf } from '@/services/pdf-import'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentStore } from '@/stores/document'
import { useSigningStore } from '@/stores/signing'

import App from '../App.vue'

// `__esModule` lets defineAsyncComponent unwrap the mocked module like a real one
vi.mock('@/views/EditorView.vue', () => ({ __esModule: true, default: { name: 'EditorView', render: () => null } }))

function dropFile(file: File) {
  const event = new Event('drop', { cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
  window.dispatchEvent(event)
}

function button(text: string) {
  return [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined
}

describe('app', () => {
  enableAutoUnmount(afterEach)

  let documents: ReturnType<typeof useDocumentStore>
  let signing: ReturnType<typeof useSigningStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:signature')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    documents = useDocumentStore()
    signing = useSigningStore()
    vi.spyOn(documents, 'open').mockResolvedValue(true)
    documents.current = { fileName: 'a.pdf', pdf: { loadingTask: { destroy: vi.fn() } } } as unknown as ImportedPdf
  })

  async function mountWithPlacedSignature() {
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    signing.arm(signing.addSource('draw', { pngBytes: new Uint8Array(), width: 3, height: 1 }).id)
    signing.place(0, { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.1 })
    return wrapper
  }

  it('opens another file right away when nothing would be lost', async () => {
    mount(App, { attachTo: document.body })
    await flushPromises()

    dropFile(new File(['%PDF-'], 'b.pdf'))

    expect(documents.open).toHaveBeenCalledOnce()
  })

  it('asks before discarding signatures that were not exported (PRD §9)', async () => {
    await mountWithPlacedSignature()
    const next = new File(['%PDF-'], 'b.pdf')

    dropFile(next)
    await flushPromises()

    expect(documents.open).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('放弃未导出的签名？')

    button('放弃并打开')!.click()
    await flushPromises()
    expect(documents.open).toHaveBeenCalledExactlyOnceWith(next)
  })

  it('keeps the signatures when the user goes back', async () => {
    await mountWithPlacedSignature()

    dropFile(new File(['%PDF-'], 'b.pdf'))
    await flushPromises()
    button('返回')!.click()
    await flushPromises()

    expect(documents.open).not.toHaveBeenCalled()
    expect(signing.placements).toHaveLength(1)
    expect(document.body.textContent).not.toContain('放弃未导出的签名？')
  })

  it('asks the browser to warn before leaving with unexported signatures', async () => {
    await mountWithPlacedSignature()
    const leaving = new Event('beforeunload', { cancelable: true })

    window.dispatchEvent(leaving)

    expect(leaving.defaultPrevented).toBe(true)
  })
})
