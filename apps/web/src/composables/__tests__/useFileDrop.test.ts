// @vitest-environment happy-dom
import type { Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import { useFileDrop } from '../useFileDrop'

function dragEvent(type: string, files: File[] | null) {
  const event = new Event(type, { cancelable: true }) as DragEvent
  const dataTransfer = files
    ? { types: ['Files'], files, dropEffect: 'none' }
    : { types: ['text/plain'], files: [], dropEffect: 'none' }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

function mountDrop() {
  const onFile = vi.fn()
  let dragging: Ref<boolean> | undefined
  const wrapper = mount(defineComponent({
    setup() {
      dragging = useFileDrop(onFile).dragging
      return () => null
    },
  }))
  return { onFile, dragging: () => dragging!.value, wrapper }
}

describe('useFileDrop', () => {
  it('opens the first dropped file instead of letting the browser navigate to it', () => {
    const { onFile, wrapper } = mountDrop()
    const pdf = new File(['%PDF-'], 'a.pdf')
    const drop = dragEvent('drop', [pdf, new File([''], 'b.pdf')])

    window.dispatchEvent(drop)

    expect(drop.defaultPrevented).toBe(true)
    expect(onFile).toHaveBeenCalledExactlyOnceWith(pdf)
    wrapper.unmount()
  })

  it('tracks a file dragged over the window across child elements', () => {
    const { dragging, wrapper } = mountDrop()
    const files = [new File([''], 'a.pdf')]

    window.dispatchEvent(dragEvent('dragenter', files))
    window.dispatchEvent(dragEvent('dragenter', files))
    window.dispatchEvent(dragEvent('dragleave', files))
    expect(dragging()).toBe(true)

    const over = dragEvent('dragover', files)
    window.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer!.dropEffect).toBe('copy')

    window.dispatchEvent(dragEvent('dragleave', files))
    expect(dragging()).toBe(false)
    wrapper.unmount()
  })

  it('ignores drags without files, such as selected text', () => {
    const { onFile, dragging, wrapper } = mountDrop()
    const drop = dragEvent('drop', null)

    window.dispatchEvent(dragEvent('dragenter', null))
    window.dispatchEvent(drop)

    expect(dragging()).toBe(false)
    expect(drop.defaultPrevented).toBe(false)
    expect(onFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('stops listening when unmounted', () => {
    const { onFile, wrapper } = mountDrop()
    wrapper.unmount()

    window.dispatchEvent(dragEvent('drop', [new File([''], 'a.pdf')]))

    expect(onFile).not.toHaveBeenCalled()
  })
})
