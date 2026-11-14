// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import SignaturePad from 'signature_pad'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SignatureDrawPad from '../SignatureDrawPad.vue'

describe('signatureDrawPad with real signature_pad pointer handling', () => {
  enableAutoUnmount(afterEach)

  let width: number
  let height: number
  let resize: () => void
  let context: CanvasRenderingContext2D

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
    width = 760
    height = 280
    context = Object.fromEntries([
      'scale',
      'clearRect',
      'fillRect',
      'beginPath',
      'moveTo',
      'arc',
      'closePath',
      'fill',
      'save',
      'lineTo',
      'stroke',
      'restore',
    ].map(name => [name, vi.fn()])) as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLCanvasElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(20, 30, width, height))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function setup(pointerType = 'pen') {
    const toData = vi.spyOn(SignaturePad.prototype, 'toData')
    const wrapper = mount(SignatureDrawPad)
    const canvas = wrapper.get('canvas').element
    const pad = toData.mock.contexts[0] as SignaturePad
    const captured = new Set<number>()
    const capture = vi.fn((id: number) => captured.add(id))
    const release = vi.fn((id: number) => captured.delete(id))
    Object.assign(canvas, {
      setPointerCapture: capture,
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: release,
    })
    function pointer(type: string, x: number, y: number, id = 7) {
      const event = new PointerEvent(type, {
        pointerId: id,
        pointerType,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX: x + 20,
        clientY: y + 30,
        pressure: 0.5,
        bubbles: true,
        cancelable: true,
      })
      ;(type === 'pointerdown' ? canvas : window).dispatchEvent(event)
      return event
    }
    return { wrapper, canvas, pad, pointer, capture, release }
  }

  it.each(['mouse', 'touch', 'pen'])('keeps %s strokes and dots the same width through fast moves, slow turns and a paused lift', async (pointerType) => {
    const { wrapper, pad, pointer } = setup(pointerType)
    const arc = vi.mocked(context.arc)
    pointer('pointerdown', 40, 40)
    pointer('pointerup', 40, 40)
    expect(arc).toHaveBeenCalledTimes(1)
    expect(arc.mock.calls[0]![2]).toBe(1.5)
    arc.mockClear()

    pointer('pointerdown', 60, 80)
    for (const [x, y, delay] of [
      [100, 80, 4],
      [180, 80, 4],
      [220, 80, 8],
      [222, 82, 100],
      [222, 100, 100],
      [222, 140, 16],
      [224, 142, 200],
    ] as const) {
      vi.advanceTimersByTime(delay)
      pointer('pointermove', x, y)
    }
    vi.advanceTimersByTime(500)
    pointer('pointerup', 226, 144)
    expect(pad.toData()).toHaveLength(2)
    expect(arc.mock.calls.length).toBeGreaterThan(20)
    for (const call of arc.mock.calls)
      expect(call[2]).toBeCloseTo(1.5)

    arc.mockClear()
    await wrapper.get('[aria-label="蓝色"]').trigger('click')
    expect(arc.mock.calls.length).toBeGreaterThan(20)
    for (const call of arc.mock.calls)
      expect(call[2]).toBeCloseTo(1.5)

    arc.mockClear()
    width = 160
    resize()
    const scaledRadius = pad.toData()[0]!.minWidth
    expect(scaledRadius).toBeLessThan(1.5)
    expect(arc.mock.calls.length).toBeGreaterThan(20)
    for (const call of arc.mock.calls)
      expect(call[2]).toBeCloseTo(scaledRadius)
  })

  it('keeps sampling one continuous stroke across resize notifications and fits every point after pointerup', () => {
    const { wrapper, canvas, pad, pointer } = setup()
    pointer('pointerdown', 40, 40)
    pointer('pointermove', 42, 42)
    pointer('pointermove', 44, 44)
    const clear = vi.spyOn(pad, 'clear')
    const backingWidth = canvas.width
    width = 300
    height = 256
    resize()
    pointer('pointermove', 300, 120)
    resize()
    pointer('pointermove', 500, 180)

    expect(pad.toData()).toHaveLength(1)
    expect(pad.toData()[0]!.points.map(point => point.x)).toEqual([40, 42, 44, 300, 500])
    expect(canvas.width).toBe(backingWidth)
    expect(clear).not.toHaveBeenCalled()
    pointer('pointerup', 740, 250)

    expect(canvas.width).toBe(600)
    expect(clear).toHaveBeenCalled()
    const points = pad.toData()[0]!.points
    expect(points).toHaveLength(6)
    for (const [index, x] of [40, 42, 44, 300, 500, 740].entries())
      expect(points[index]!.x).toBeCloseTo(5 + (x - 40) * 290 / 700)
    expect(points.every(point => point.pressure === 0.5)).toBe(true)
    expect(wrapper.emitted('change')).toEqual([[false]])
  })

  it('samples small fast moves immediately and never replays the previous stroke into the next one', () => {
    const { pad, pointer } = setup()
    pointer('pointerdown', 40, 40)
    for (const x of [42, 44]) {
      vi.advanceTimersByTime(1)
      pointer('pointermove', x, 40)
    }
    pointer('pointerup', 46, 40)
    pointer('pointerdown', 200, 80, 8)
    vi.advanceTimersByTime(20)
    expect(pad.toData()[1]!.points.map(point => point.x)).toEqual([200])
    for (const x of [202, 204]) {
      vi.advanceTimersByTime(1)
      pointer('pointermove', x, 80, 8)
    }
    pointer('pointerup', 206, 80, 8)
    vi.advanceTimersByTime(50)

    expect(pad.toData().map(group => group.points.map(point => [point.x, point.y]))).toEqual([
      [[40, 40], [42, 40], [44, 40], [46, 40]],
      [[200, 80], [202, 80], [204, 80], [206, 80]],
    ])
  })

  it('releases capture and pending resize after pointercancel, then accepts a fresh stroke', async () => {
    const { wrapper, canvas, pad, pointer, capture, release } = setup()
    pointer('pointerdown', 40, 40)
    pointer('pointermove', 80, 60)
    expect(capture).toHaveBeenCalledExactlyOnceWith(7)
    width = 300
    resize()
    expect(canvas.width).toBe(1520)
    const canceled = pointer('pointercancel', 500, 200)
    await wrapper.vm.$nextTick()

    expect(canceled.defaultPrevented).toBe(true)
    expect(release).toHaveBeenCalledExactlyOnceWith(7)
    expect(canvas.width).toBe(600)
    expect(pad.toData()[0]!.points.map(point => point.x)).toEqual([40, 80])
    expect(wrapper.get('.signature-mode-button').attributes('disabled')).toBeUndefined()
    const selection = new Event('selectstart', { cancelable: true })
    document.dispatchEvent(selection)
    expect(selection.defaultPrevented).toBe(false)

    pointer('pointerdown', 120, 100, 8)
    pointer('pointermove', 140, 110, 8)
    pointer('pointerup', 160, 120, 8)
    expect(pad.toData()).toHaveLength(2)
    expect(pad.toData()[1]!.points.map(point => point.x)).toEqual([120, 140, 160])
    expect(release).toHaveBeenLastCalledWith(8)
    expect(wrapper.emitted('change')).toEqual([[false], [false]])
  })

  it('ignores other pointers and stops accepting window moves and new strokes after unmount', () => {
    const { wrapper, pad, pointer, release } = setup()
    pointer('pointerdown', 40, 40)
    pointer('pointermove', 200, 80, 8)
    pointer('pointerup', 220, 80, 8)
    expect(pad.toData()[0]!.points.map(point => point.x)).toEqual([40])
    expect(release).not.toHaveBeenCalled()
    pointer('pointermove', 60, 50)
    const data = structuredClone(pad.toData())
    wrapper.unmount()
    expect(release).toHaveBeenCalledExactlyOnceWith(7)
    pointer('pointermove', 80, 60)
    pointer('pointerup', 100, 70)
    pointer('pointerdown', 200, 80, 8)
    expect(pad.toData()).toEqual(data)
    const selection = new Event('selectstart', { cancelable: true })
    document.dispatchEvent(selection)
    expect(selection.defaultPrevented).toBe(false)
  })

  it('supports the iOS touch fallback, defers resize and resumes drawing after touchcancel', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15')
    const originalTouchStart = Object.getOwnPropertyDescriptor(document, 'ontouchstart')
    Object.defineProperty(document, 'ontouchstart', { configurable: true, value: null })
    vi.stubGlobal('ontouchstart', null)
    try {
      const { wrapper, canvas, pad, capture } = setup()
      function touch(type: string, x: number, y: number) {
        const point = { clientX: x + 20, clientY: y + 30, force: 0.5, identifier: 1 }
        const event = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          changedTouches: [point as Touch],
          targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : [point as Touch],
        })
        ;(type === 'touchstart' ? canvas : window).dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      }

      touch('touchstart', 40, 40)
      touch('touchmove', 80, 60)
      width = 300
      resize()
      expect(canvas.width).toBe(1520)
      touch('touchmove', 120, 80)
      expect(pad.toData()[0]!.points.map(point => point.x)).toEqual([40, 80, 120])
      touch('touchcancel', 500, 200)
      await wrapper.vm.$nextTick()

      expect(canvas.width).toBe(600)
      expect(pad.toData()[0]!.points.map(point => point.x)).toEqual([40, 80, 120])
      expect(capture).not.toHaveBeenCalled()
      expect(wrapper.get('.signature-mode-button').attributes('disabled')).toBeUndefined()
      touch('touchstart', 160, 100)
      touch('touchmove', 180, 110)
      vi.advanceTimersByTime(200)
      touch('touchend', 200, 120)
      expect(pad.toData()).toHaveLength(2)
      expect(pad.toData()[1]!.points.map(point => point.x)).toEqual([160, 180, 200])
      expect(vi.mocked(context.arc).mock.calls.length).toBeGreaterThan(10)
      for (const call of vi.mocked(context.arc).mock.calls)
        expect(call[2]).toBeCloseTo(1.5)
      expect(wrapper.emitted('change')).toEqual([[false], [false]])
    }
    finally {
      if (originalTouchStart)
        Object.defineProperty(document, 'ontouchstart', originalTouchStart)
      else
        Reflect.deleteProperty(document, 'ontouchstart')
    }
  })
})
