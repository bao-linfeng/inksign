// @vitest-environment happy-dom
import type { PreviewPage } from '@/services/pdf-import'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderDateImage } from '@/services/date-renderer'
import { useSigningStore } from '@/stores/signing'

import SignaturePanel from '../SignaturePanel.vue'

// happy-dom has no canvas text rendering
vi.mock('@/services/date-renderer', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/date-renderer')>(),
  renderDateImage: vi.fn(async () => ({ pngBytes: new Uint8Array([7]), width: 600, height: 100 })),
}))

const a4: PreviewPage = { geometry: { view: [0, 0, 595, 842], rotation: 0 }, width: 595, height: 842 }
const pages = [a4, a4, a4, a4]
// 150 × 50 points at (100, 200)
const rect = { xRatio: 100 / 595, yRatio: 200 / 842, widthRatio: 150 / 595, heightRatio: 50 / 842 }

function button(text: string) {
  return [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement | undefined
}

describe('signaturePanel', () => {
  enableAutoUnmount(afterEach)

  let signing: ReturnType<typeof useSigningStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    signing = useSigningStore()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:signature')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    localStorage.clear()
  })

  async function mountWithSelection() {
    const source = signing.addSource('draw', { pngBytes: new Uint8Array([1]), width: 300, height: 100 })
    const placement = signing.placeSource(source.id, 0, rect)!
    mount(SignaturePanel, { props: { pages }, attachTo: document.body })
    await flushPromises()
    return { source, placement }
  }

  it('applies the selected signature to all pages, then deletes the group (PRD FR-10)', async () => {
    const { source } = await mountWithSelection()
    signing.placeSource(source.id, 3, rect)
    signing.select(signing.placements[0]!.id)
    await flushPromises()

    button('应用到多页')!.click()
    await flushPromises()
    expect(document.body.textContent).toContain('将在 2 页添加签名，已有此签名的 2 页跳过。')
    button('应用')!.click()
    await flushPromises()

    expect(signing.placements.map(p => p.pageIndex)).toEqual([0, 3, 1, 2])
    expect(document.body.textContent).toContain('批量组 3 处')

    button('删除整组')!.click()
    await flushPromises()
    // The one placed by hand on page 4 stays
    expect(signing.placements.map(p => p.pageIndex)).toEqual([3])
  })

  it('checks a custom page range (PRD §9)', async () => {
    await mountWithSelection()
    button('应用到多页')!.click()
    await flushPromises()

    const custom = [...document.body.querySelectorAll('[role="radio"]')].find(r => r.parentElement?.textContent?.includes('自定义')) as HTMLElement
    custom.click()
    await flushPromises()
    const input = document.body.querySelector('input[aria-label="自定义页码"]') as HTMLInputElement
    input.value = '2-9'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(document.body.textContent).toContain('页码范围无效，请输入如 1-3,5 的格式，且不超过总页数。')
    expect(button('应用')!.disabled).toBe(true)

    input.value = '2，4'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    button('应用')!.click()
    await flushPromises()
    expect(signing.placements.map(p => p.pageIndex)).toEqual([0, 1, 3])
  })

  it('adds a date under the selected signature, asking for it the first time (PRD FR-09)', async () => {
    const { placement } = await mountWithSelection()

    button('在下方添加日期')!.click()
    await flushPromises()
    button('添加到签名下方')!.click()
    await flushPromises()

    expect(renderDateImage).toHaveBeenCalledWith(expect.objectContaining({ format: 'zh', color: '#1a1a1a' }))
    const date = signing.placements.at(-1)!
    expect(signing.sourceOf(date.sourceId)?.kind).toBe('date')
    expect(date.pageIndex).toBe(0)
    // 18 points high, 6:1, centred 4 points under the signature
    expect(date.yRatio * 842).toBeCloseTo(254)
    expect(date.heightRatio * 842).toBeCloseTo(18)
    expect((date.xRatio + date.widthRatio / 2) * 595).toBeCloseTo(175)
    expect(signing.selectedId).toBe(date.id)

    // The next one reuses that date without asking
    signing.select(placement.id)
    await flushPromises()
    button('在下方添加日期')!.click()
    await flushPromises()
    expect(signing.placements.filter(p => p.sourceId === date.sourceId)).toHaveLength(2)
    expect(renderDateImage).toHaveBeenCalledOnce()
  })
})
