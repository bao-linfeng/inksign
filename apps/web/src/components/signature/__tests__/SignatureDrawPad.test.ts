// @vitest-environment happy-dom
import type { PointGroup } from 'signature_pad'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canvasToPng, trimCanvas } from '@/services/signature-image'

import SignatureDrawPad from '../SignatureDrawPad.vue'

const mock = vi.hoisted(() => ({
  strokes: [] as PointGroup[],
  events: {} as Record<string, (event: Event) => void>,
  resize: () => {},
  width: 320,
  height: 256,
  off: vi.fn(),
  disconnect: vi.fn(),
  clear: vi.fn(),
  fromData: vi.fn(),
}))

vi.mock('signature_pad', () => ({
  default: class {
    penColor = '#171717'
    toData() { return mock.strokes }
    fromData(strokes: PointGroup[]) {
      mock.fromData(strokes)
      mock.strokes = strokes
    }

    clear() {
      mock.clear()
      mock.strokes = []
    }

    isEmpty() { return mock.strokes.length === 0 }
    addEventListener(name: string, listener: (event: Event) => void) { mock.events[name] = listener }
    off = mock.off
  },
}))

vi.mock('@/services/signature-image', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/signature-image')>(),
  trimCanvas: vi.fn(),
  canvasToPng: vi.fn(),
}))

function strokeEvent(name: 'beginStroke' | 'endStroke', source: Event = new PointerEvent(name === 'beginStroke' ? 'pointerdown' : 'pointerup', { pointerId: 7 })) {
  mock.events[name]!(new CustomEvent(name, { detail: { event: source } }))
}

function draw() {
  mock.strokes = [{
    penColor: '#171717',
    minWidth: 1.5,
    maxWidth: 1.5,
    dotSize: 1.5,
    velocityFilterWeight: 0.6,
    compositeOperation: 'source-over',
    points: [{ x: 40, y: 40, time: 10, pressure: 0.5 }, { x: 700, y: 250, time: 20, pressure: 0.7 }],
  }]
  strokeEvent('endStroke')
}

describe('signatureDrawPad resizing', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mock.strokes = []
    mock.events = {}
    mock.width = 760
    mock.height = 280
    vi.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockImplementation(() => mock.width)
    vi.spyOn(HTMLCanvasElement.prototype, 'offsetHeight', 'get').mockImplementation(() => mock.height)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { mock.resize = callback }
      observe() {}
      disconnect = mock.disconnect
    })
    vi.mocked(trimCanvas).mockReturnValue({ width: 600, height: 200 } as HTMLCanvasElement)
    vi.mocked(canvasToPng).mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('fits landscape strokes into portrait without clipping or distorting, then exports', async () => {
    const wrapper = mount(SignatureDrawPad)
    draw()
    mock.width = 300
    mock.height = 256
    mock.resize()

    const [first, last] = mock.strokes[0]!.points
    expect(first!.x).toBeGreaterThanOrEqual(5)
    expect(last!.x).toBeLessThanOrEqual(295)
    expect(last!.y).toBeLessThanOrEqual(251)
    expect((last!.x - first!.x) / (last!.y - first!.y)).toBeCloseTo(660 / 210)
    expect(mock.strokes[0]!.minWidth).toBeCloseTo(1.5 * 290 / 660)
    expect(mock.strokes[0]!.maxWidth).toBeCloseTo(1.5 * 290 / 660)
    expect(mock.strokes[0]!.dotSize).toBeCloseTo(1.5 * 290 / 660)
    expect(last).toMatchObject({ time: 20, pressure: 0.7 })
    expect(await wrapper.vm.toImage()).toMatchObject({ width: 600, height: 200 })
    expect(trimCanvas).toHaveBeenCalled()

    const fitted = structuredClone(mock.strokes)
    mock.width = 760
    mock.height = 280
    mock.resize()
    expect(mock.strokes).toEqual(fitted)
    expect(wrapper.emitted('change')).toEqual([[false]])
  })

  it('ignores hidden tabs and preserves drawing and color through expansion', async () => {
    const wrapper = mount(SignatureDrawPad)
    draw()
    const original = structuredClone(mock.strokes)
    mock.width = 0
    mock.height = 0
    mock.resize()
    expect(mock.strokes).toEqual(original)
    await wrapper.setProps({ expanded: true })
    mock.width = 800
    mock.height = 300
    mock.resize()
    expect(mock.strokes).toEqual(original)
    await wrapper.get('[aria-label="蓝色"]').trigger('click')
    expect(mock.strokes[0]!.penColor).not.toBe(original[0]!.penColor)
    expect(mock.strokes[0]!.points).toEqual(original[0]!.points)
    await wrapper.setProps({ expanded: false })
    expect(mock.strokes[0]!.points).toEqual(original[0]!.points)
  })

  it('does not export blank or cleared drawings and releases resize listeners', async () => {
    const wrapper = mount(SignatureDrawPad)
    expect(await wrapper.vm.toImage()).toBeNull()
    draw()
    await wrapper.vm.$nextTick()
    await wrapper.findAll('button').find(button => button.text() === '清空')!.trigger('click')
    expect(await wrapper.vm.toImage()).toBeNull()
    expect(wrapper.emitted('change')).toEqual([[false], [true]])
    wrapper.unmount()
    expect(mock.off).toHaveBeenCalled()
    expect(mock.disconnect).toHaveBeenCalled()
  })

  it('defers every resize until the active stroke ends and includes points added after resizing', () => {
    const wrapper = mount(SignatureDrawPad)
    const canvas = wrapper.get('canvas').element
    draw()
    const width = canvas.width
    const original = mock.strokes
    mock.clear.mockClear()
    mock.fromData.mockClear()
    strokeEvent('beginStroke')
    mock.width = 300
    mock.height = 256
    mock.resize()
    mock.resize()

    expect(canvas.width).toBe(width)
    expect(mock.strokes).toBe(original)
    expect(mock.clear).not.toHaveBeenCalled()
    expect(mock.fromData).not.toHaveBeenCalled()
    mock.strokes[0]!.points.push({ x: 740, y: 270, time: 30, pressure: 0.8 })
    strokeEvent('endStroke')

    expect(canvas.width).toBe(600)
    expect(mock.strokes).toHaveLength(1)
    expect(mock.strokes[0]!.points).toHaveLength(3)
    expect(mock.strokes[0]!.points[2]).toMatchObject({ time: 30, pressure: 0.8 })
    expect(mock.strokes[0]!.points[2]!.x).toBeCloseTo(295)
    expect(mock.clear).toHaveBeenCalledTimes(1)
    expect(mock.fromData).toHaveBeenCalledTimes(1)
  })

  it('captures the initiating pointer and releases it when the stroke ends', () => {
    const wrapper = mount(SignatureDrawPad)
    const canvas = wrapper.get('canvas').element
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(canvas, { setPointerCapture, hasPointerCapture: vi.fn().mockReturnValue(true), releasePointerCapture })
    strokeEvent('beginStroke')
    expect(setPointerCapture).toHaveBeenCalledExactlyOnceWith(7)
    strokeEvent('endStroke')
    expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
    wrapper.unmount()
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
  })

  it('clears existing selection and prevents document selection only while drawing', () => {
    const wrapper = mount(SignatureDrawPad)
    const removeAllRanges = vi.spyOn(window.getSelection()!, 'removeAllRanges')
    const select = () => {
      const event = new Event('selectstart', { bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      return event.defaultPrevented
    }

    expect(select()).toBe(false)
    strokeEvent('beginStroke')
    expect(removeAllRanges).toHaveBeenCalledTimes(1)
    expect(select()).toBe(true)
    strokeEvent('endStroke')
    expect(select()).toBe(false)
    wrapper.unmount()
  })

  it.each(['touchstart', 'touchmove', 'contextmenu', 'selectstart'])('prevents native %s behavior on the canvas while idle', (type) => {
    const wrapper = mount(SignatureDrawPad)
    const event = new Event(type, { bubbles: true, cancelable: true })
    wrapper.get('canvas').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('disables color, clear and expanded mode only during a stroke', async () => {
    const wrapper = mount(SignatureDrawPad)
    draw()
    strokeEvent('beginStroke')
    await wrapper.vm.$nextTick()
    const controls = () => [
      wrapper.get('.signature-mode-button'),
      wrapper.get('[aria-label="蓝色"]'),
      wrapper.findAll('button').find(button => button.text() === '清空')!,
    ]
    for (const control of controls())
      expect(control.attributes('disabled')).toBeDefined()
    strokeEvent('endStroke')
    await wrapper.vm.$nextTick()
    for (const control of controls())
      expect(control.attributes('disabled')).toBeUndefined()
  })

  it('releases active capture, disconnects resizing and removes document selection blocking on unmount', () => {
    const wrapper = mount(SignatureDrawPad)
    const canvas = wrapper.get('canvas').element
    const releasePointerCapture = vi.fn()
    Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture })
    const removeListener = vi.spyOn(document, 'removeEventListener')
    strokeEvent('beginStroke')
    wrapper.unmount()

    expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
    expect(mock.disconnect).toHaveBeenCalledTimes(1)
    expect(mock.off).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith('selectstart', expect.any(Function), true)
    const selection = new Event('selectstart', { cancelable: true })
    document.dispatchEvent(selection)
    expect(selection.defaultPrevented).toBe(false)
  })
})
