// @vitest-environment happy-dom
import type { ImportedPdf } from '@/services/pdf-import'
import type { DigitalSignatureInfo } from '@/services/pdf-inspector'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import EditorView from '../EditorView.vue'

const APPROVAL_NOTICE = '此文件已包含数字签名。添加签名后原签名本身不会被破坏，但阅读器可能提示签名后文档被修改。'
const CERTIFICATION_WARNING = '此文件经过认证签名，添加签名后认证将显示为无效。'

function doc(signatures: DigitalSignatureInfo = { signedFields: 0 }): ImportedPdf {
  return { fileName: '合同-2026.pdf', bytes: new Uint8Array(), pdf: {}, pages: [], signatures } as unknown as ImportedPdf
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
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the file name in the top bar', () => {
    const wrapper = mountEditor({ doc: doc() })

    expect(wrapper.get('header').text()).toContain('合同-2026.pdf')
    expect(wrapper.text()).not.toContain('数字签名')
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
})
