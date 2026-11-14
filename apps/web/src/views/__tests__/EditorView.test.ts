// @vitest-environment happy-dom
import type { ImportedPdf } from '@/services/pdf-import'
import type { DigitalSignatureInfo } from '@/services/pdf-inspector'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadBytes } from '@/services/download'
import { exportSignedPdf } from '@/services/pdf-exporter'
import { useSigningStore } from '@/stores/signing'

import EditorView from '../EditorView.vue'

vi.mock('@/services/pdf-exporter', () => ({ exportSignedPdf: vi.fn() }))
vi.mock('@/services/date-renderer', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/date-renderer')>(),
  renderDateImage: vi.fn(async () => ({ pngBytes: new Uint8Array([7]), width: 600, height: 100 })),
}))
vi.mock('@/services/download', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/download')>(),
  downloadBytes: vi.fn(),
}))

const APPROVAL_NOTICE = '此文件已包含数字签名。添加签名后原签名本身不会被破坏，但阅读器可能提示签名后文档被修改。'
const CERTIFICATION_WARNING = '此文件经过认证签名，添加签名后认证将显示为无效。'

function doc(signatures: DigitalSignatureInfo = { signedFields: 0 }): ImportedPdf {
  const geometry = { view: [0, 0, 595, 842], rotation: 0 }
  return { fileName: '合同-2026.pdf', bytes: new Uint8Array([1]), pdf: {}, pages: [{ geometry, width: 595, height: 842 }], signatures } as unknown as ImportedPdf
}

function mountEditor(props: { doc: ImportedPdf, loading?: boolean, error?: string | null }) {
  return mount(EditorView, {
    props,
    // The dialog teleports to <body>
    attachTo: document.body,
    global: { stubs: { PdfViewer: true } },
  })
}

describe('editorView', () => {
  // Also removes the teleported dialogs from <body>
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:signature')
    vi.mocked(exportSignedPdf).mockReset()
    vi.mocked(downloadBytes).mockReset()
  })

  it('shows the file name in the top bar', () => {
    const wrapper = mountEditor({ doc: doc() })

    expect(wrapper.get('header').text()).toContain('合同-2026.pdf')
    expect(wrapper.text()).not.toContain('数字签名')
  })

  it('gives header actions minimum touch targets on narrow and coarse-pointer screens', () => {
    const wrapper = mountEditor({ doc: doc() })
    const actions = wrapper.findAll('header button')
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(action.classes()).toEqual(expect.arrayContaining([
        'max-md:min-h-11',
        'max-md:min-w-11',
        'pointer-coarse:min-h-11',
        'pointer-coarse:min-w-11',
      ]))
    }
  })

  it('opens mobile tools and returns to the PDF when a source is armed', async () => {
    const wrapper = mountEditor({ doc: doc() })
    const toggle = wrapper.get('[aria-controls="signature-tools"]')
    const tools = wrapper.get('#signature-tools')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(tools.classes()).toContain('max-md:hidden')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(tools.classes()).not.toContain('max-md:hidden')
    expect(tools.text()).toContain('日期')

    const signing = useSigningStore()
    signing.arm(signing.addSource('image', { pngBytes: new Uint8Array([1]), width: 300, height: 100 }).id)
    await flushPromises()

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('点击页面放置签名')
  })

  it('creates a date from mobile tools and closes them for placement', async () => {
    const wrapper = mountEditor({ doc: doc() })
    await wrapper.get('[aria-controls="signature-tools"]').trigger('click')
    await wrapper.findAll('#signature-tools button').find(button => button.text() === '日期')!.trigger('click')
    await flushPromises()

    const confirm = [...document.body.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.trim() === '使用此日期') as HTMLButtonElement
    expect(confirm).toBeDefined()
    confirm.click()
    await flushPromises()

    const signing = useSigningStore()
    expect(signing.sourceOf(signing.armedSourceId!)?.kind).toBe('date')
    expect(wrapper.get('[aria-controls="signature-tools"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('点击页面放置日期')
  })

  it('warns that existing approval signatures will be reported as modified (FR-01)', () => {
    const wrapper = mountEditor({ doc: doc({ signedFields: 2 }) })

    expect(wrapper.text()).toContain(APPROVAL_NOTICE)
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('asks before signing a certified document', async () => {
    const wrapper = mountEditor({ doc: doc({ signedFields: 1, certification: 2 }) })
    await flushPromises()

    const dialog = document.body.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('此文件经过认证签名')
    expect(wrapper.text()).not.toContain(APPROVAL_NOTICE)

    const proceed = [...dialog.querySelectorAll('button')].find(button => button.textContent?.includes('继续签名'))!
    proceed.click()
    await flushPromises()

    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull()
    expect(wrapper.text()).toContain(CERTIFICATION_WARNING)
  })

  it('closes the document when the user declines the certification warning', async () => {
    const wrapper = mountEditor({ doc: doc({ signedFields: 1, certification: 1 }) })
    await flushPromises()

    const cancel = [...document.body.querySelectorAll('[role="alertdialog"] button')].find(button => button.textContent?.includes('换一个文件'))!
    ;(cancel as HTMLButtonElement).click()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps the document open and dismissible when another file fails to open', async () => {
    const wrapper = mountEditor({ doc: doc(), error: '暂不支持受密码保护的 PDF。' })

    expect(wrapper.get('[role="alert"]').text()).toContain('暂不支持受密码保护的 PDF。')
    await wrapper.get('[aria-label="关闭提示"]').trigger('click')

    expect(wrapper.emitted('dismissError')).toHaveLength(1)
  })

  it('reopens another file from the top bar', async () => {
    const wrapper = mountEditor({ doc: doc() })
    const input = wrapper.get('input[type="file"]')
    const file = new File(['%PDF-'], 'next.pdf')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })

    await input.trigger('change')

    expect(wrapper.emitted('select')).toEqual([[file]])
  })

  it('exports only once something is placed, after showing the legal notice (FR-06)', async () => {
    const wrapper = mountEditor({ doc: doc() })
    const exportButton = () => wrapper.findAll('header button').find(button => button.text().includes('导出 PDF'))!
    expect(exportButton().attributes('disabled')).toBeDefined()

    const signing = useSigningStore()
    const source = signing.addSource('draw', { pngBytes: new Uint8Array([9]), width: 300, height: 100 })
    signing.arm(source.id)
    signing.place(0, { xRatio: 0.6, yRatio: 0.8, widthRatio: 0.25, heightRatio: 0.06 })
    await flushPromises()
    await exportButton().trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('不等同于证书数字签名')
    expect(dialog.textContent).toContain('合同-2026_signed.pdf')

    vi.mocked(exportSignedPdf).mockResolvedValue({ bytes: new Uint8Array([7]), incremental: false })
    ;[...dialog.querySelectorAll('button')].find(button => button.textContent?.includes('导出并下载'))!.click()
    await flushPromises()

    expect(exportSignedPdf).toHaveBeenCalledWith({
      originalBytes: new Uint8Array([1]),
      pages: [{ view: [0, 0, 595, 842], rotation: 0 }],
      images: new Map([[source.id, new Uint8Array([9])]]),
      placements: signing.placements,
    })
    expect(downloadBytes).toHaveBeenCalledWith(new Uint8Array([7]), '合同-2026_signed.pdf', 'application/pdf')
    expect(signing.hasUnexported).toBe(false)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the dialog open with a retry when the export fails', async () => {
    const wrapper = mountEditor({ doc: doc() })
    const signing = useSigningStore()
    signing.arm(signing.addSource('draw', { pngBytes: new Uint8Array(), width: 3, height: 1 }).id)
    signing.place(0, { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.1 })
    vi.mocked(exportSignedPdf).mockRejectedValue(new Error('boom'))
    await flushPromises()

    await wrapper.findAll('header button').find(button => button.text().includes('导出 PDF'))!.trigger('click')
    await flushPromises()
    ;[...document.body.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.includes('导出并下载'))!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('导出失败，请重试或尝试较小的 PDF。')
    expect(dialog.textContent).toContain('重试')
    expect(downloadBytes).not.toHaveBeenCalled()
    expect(signing.hasUnexported).toBe(true)
  })

  it('shows a placing hint while a signature is armed and cancels it with Esc', async () => {
    const wrapper = mountEditor({ doc: doc() })
    const signing = useSigningStore()
    signing.arm(signing.addSource('draw', { pngBytes: new Uint8Array(), width: 3, height: 1 }).id)
    await flushPromises()
    expect(wrapper.text()).toContain('点击页面放置签名')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(signing.armedSourceId).toBeNull()
    expect(wrapper.text()).not.toContain('点击页面放置签名')
  })
})
