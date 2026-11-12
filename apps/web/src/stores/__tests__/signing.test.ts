import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSigningStore } from '../signing'

const image = { pngBytes: new Uint8Array([1, 2, 3]), width: 300, height: 100 }
const rect = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.05 }

describe('signing store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${Math.random()}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('keeps a new signature with a preview URL', () => {
    const signing = useSigningStore()
    const source = signing.addSource('draw', image)

    expect(source).toMatchObject({ kind: 'draw', pngBytes: image.pngBytes, naturalWidth: 300, naturalHeight: 100 })
    expect(source.previewUrl).toMatch(/^blob:/)
    expect(signing.sourceOf(source.id)).toStrictEqual(source)
  })

  it('places the armed signature once, then selects it', () => {
    const signing = useSigningStore()
    const source = signing.addSource('draw', image)

    expect(signing.place(0, rect)).toBeNull()
    signing.arm(source.id)
    const placement = signing.place(2, rect)!

    expect(placement).toMatchObject({ sourceId: source.id, pageIndex: 2, ...rect })
    expect(signing.selected).toStrictEqual(placement)
    expect(signing.armedSourceId).toBeNull()
    expect(signing.hasUnexported).toBe(true)
  })

  it('moves and deletes instances independently (PRD §10 case 7)', () => {
    const signing = useSigningStore()
    const source = signing.addSource('draw', image)
    signing.arm(source.id)
    const first = signing.place(0, rect)!
    signing.arm(source.id)
    const second = signing.place(1, rect)!

    signing.update(first.id, { ...rect, xRatio: 0.5 })
    signing.remove(second.id)

    expect(signing.placements).toEqual([{ ...first, xRatio: 0.5 }])
    expect(signing.selectedId).toBeNull()
  })

  it('removing a signature removes its placements and frees its preview', () => {
    const signing = useSigningStore()
    const kept = signing.addSource('draw', image)
    const dropped = signing.addSource('image', image)
    signing.arm(kept.id)
    signing.place(0, rect)
    signing.arm(dropped.id)
    signing.place(0, rect)
    signing.arm(dropped.id)

    signing.removeSource(dropped.id)

    expect(signing.sources.map(s => s.id)).toEqual([kept.id])
    expect(signing.placements.map(p => p.sourceId)).toEqual([kept.id])
    expect(signing.armedSourceId).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(dropped.previewUrl)
  })

  it('only warns about placed signatures that were not exported', () => {
    const signing = useSigningStore()
    const source = signing.addSource('draw', image)
    expect(signing.hasUnexported).toBe(false)

    signing.arm(source.id)
    const placement = signing.place(0, rect)!
    signing.markExported()
    expect(signing.hasUnexported).toBe(false)

    signing.update(placement.id, { ...rect, yRatio: 0.3 })
    expect(signing.hasUnexported).toBe(true)

    signing.remove(placement.id)
    expect(signing.hasUnexported).toBe(false)
  })

  it('arming deselects, and reset forgets everything', () => {
    const signing = useSigningStore()
    const source = signing.addSource('draw', image)
    signing.arm(source.id)
    signing.place(0, rect)
    signing.arm(source.id)
    expect(signing.selectedId).toBeNull()

    signing.reset()

    expect(signing.sources).toEqual([])
    expect(signing.placements).toEqual([])
    expect(signing.armedSourceId).toBeNull()
    expect(signing.hasUnexported).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(source.previewUrl)
  })
})
