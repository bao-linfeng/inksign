// @vitest-environment happy-dom
import type { PreviewPage } from '@/services/pdf-import'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSigningStore } from '@/stores/signing'

import SignatureLayer from '../SignatureLayer.vue'

const page: PreviewPage = { geometry: { view: [0, 0, 600, 800], rotation: 0 }, width: 600, height: 800 }
/** Displayed at 50 %: 300 × 400 CSS pixels */
const LAYER = { left: 100, top: 50, width: 300, height: 400 }

function mountLayer(pageIndex = 0) {
  const wrapper = mount(SignatureLayer, { props: { pageIndex, page }, attachTo: document.body })
  wrapper.element.getBoundingClientRect = () => ({ ...LAYER, right: 400, bottom: 450, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect
  return wrapper
}

function pointer(type: string, clientX: number, clientY: number) {
  return new PointerEvent(type, { clientX, clientY, pointerId: 1, button: 0, bubbles: true, cancelable: true })
}

function boxOf(signing: ReturnType<typeof useSigningStore>) {
  const { xRatio, yRatio, widthRatio, heightRatio } = signing.placements[0]!
  return { x: xRatio * 600, y: yRatio * 800, width: widthRatio * 600, height: heightRatio * 800 }
}

describe('signatureLayer', () => {
  let signing: ReturnType<typeof useSigningStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    signing = useSigningStore()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:signature')
    // Pointer capture is not implemented by happy-dom
    HTMLElement.prototype.setPointerCapture = vi.fn()
  })

  function placeAt(clientX: number, clientY: number) {
    const source = signing.addSource('draw', { pngBytes: new Uint8Array(), width: 300, height: 100 })
    signing.arm(source.id)
    const wrapper = mountLayer()
    wrapper.element.dispatchEvent(new MouseEvent('click', { clientX, clientY, bubbles: true }))
    return wrapper
  }

  it('places the armed signature centred on the click (PRD FR-05)', async () => {
    const wrapper = placeAt(250, 250)
    await wrapper.vm.$nextTick()

    // Click at the page centre: (300, 400) in page units; 150 × 50 signature
    const box = boxOf(signing)
    expect(box.x).toBeCloseTo(225)
    expect(box.y).toBeCloseTo(375)
    expect(box.width).toBeCloseTo(150)
    expect(box.height).toBeCloseTo(50)
    const placed = wrapper.get('[role="button"]').element as HTMLElement
    expect(placed.style.left).toBe('37.5%')
    expect(placed.getAttribute('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('keeps an enlarged delete target separate from resize handles on touch screens', async () => {
    const wrapper = placeAt(250, 250)
    await wrapper.vm.$nextTick()
    const remove = wrapper.get('button[aria-label="删除此签名"]')
    expect(remove.classes()).toEqual(expect.arrayContaining([
      'max-md:size-11',
      'pointer-coarse:size-11',
      'max-md:-top-15',
      'pointer-coarse:-top-15',
    ]))
    await remove.trigger('pointerdown')
    await remove.trigger('click')
    expect(signing.placements).toHaveLength(0)
    wrapper.unmount()
  })

  it('deselects when the page is clicked without an armed signature', async () => {
    const wrapper = placeAt(250, 250)
    await wrapper.vm.$nextTick()

    wrapper.element.dispatchEvent(new MouseEvent('click', { clientX: 120, clientY: 60, bubbles: true }))

    expect(signing.selectedId).toBeNull()
    expect(signing.placements).toHaveLength(1)
    wrapper.unmount()
  })

  it('drags a signature in page units, whatever the zoom', async () => {
    const wrapper = placeAt(250, 250)
    await wrapper.vm.$nextTick()
    const placed = wrapper.get('[role="button"]').element

    placed.dispatchEvent(pointer('pointerdown', 250, 250))
    // 30 CSS pixels at 50 % zoom are 60 page units
    placed.dispatchEvent(pointer('pointermove', 280, 230))
    placed.dispatchEvent(pointer('pointerup', 280, 230))

    expect(boxOf(signing).x).toBeCloseTo(285)
    expect(boxOf(signing).y).toBeCloseTo(335)
    wrapper.unmount()
  })

  it('resizes from a corner and keeps the aspect ratio', async () => {
    const wrapper = placeAt(250, 250)
    await wrapper.vm.$nextTick()
    const handle = wrapper.get('[aria-label="拖动右下角缩放"]').element

    handle.dispatchEvent(pointer('pointerdown', 300, 262.5))
    handle.dispatchEvent(pointer('pointermove', 337.5, 275))
    handle.dispatchEvent(pointer('pointerup', 337.5, 275))

    const box = boxOf(signing)
    expect(box.x).toBeCloseTo(225)
    expect(box.width).toBeCloseTo(225)
    expect(box.width / box.height).toBeCloseTo(3)
    wrapper.unmount()
  })

  it('moves with the arrow keys and deletes with Delete', async () => {
    const wrapper = placeAt(250, 250)
    await wrapper.vm.$nextTick()
    const placed = wrapper.get('[role="button"]')

    await placed.trigger('keydown', { key: 'ArrowRight' })
    await placed.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    expect(boxOf(signing).x).toBeCloseTo(226)
    expect(boxOf(signing).y).toBeCloseTo(385)

    await placed.trigger('keydown', { key: 'Delete' })
    expect(signing.placements).toEqual([])
    wrapper.unmount()
  })

  it('shows only the placements of its own page', async () => {
    placeAt(250, 250).unmount()

    expect(mountLayer(1).find('[role="button"]').exists()).toBe(false)
    expect(mountLayer(0).find('[role="button"]').exists()).toBe(true)
  })
})
