import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSigningStore } from '../signing'

const image = { pngBytes: new Uint8Array([1, 2, 3]), width: 300, height: 100 }
const rect = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.05 }
const a4 = { width: 595, height: 842 }
const landscape = { width: 842, height: 595 }

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

  it('updates every placement of a date when its image changes (PRD FR-09)', () => {
    const signing = useSigningStore()
    const date = { value: '2026-11-12', format: 'dash' as const, color: '#1a1a1a' }
    const source = signing.addSource('date', { pngBytes: new Uint8Array([1]), width: 600, height: 100 }, date)
    // 108 × 18 points centred at x = 175
    const placed = { xRatio: 121 / 595, yRatio: 0.5, widthRatio: 108 / 595, heightRatio: 18 / 842 }
    signing.placeSource(source.id, 0, placed)
    signing.markExported()

    const zh = { ...date, format: 'zh' as const }
    signing.replaceImage(source.id, { pngBytes: new Uint8Array([2]), width: 800, height: 100 }, [a4], zh)

    const updated = signing.sourceOf(source.id)!
    expect(updated).toMatchObject({ pngBytes: new Uint8Array([2]), naturalWidth: 800, date: zh })
    expect(updated.previewUrl).not.toBe(source.previewUrl)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(source.previewUrl)
    const [placement] = signing.placements
    expect(placement!.widthRatio * 595).toBeCloseTo(144)
    expect((placement!.xRatio + placement!.widthRatio / 2) * 595).toBeCloseTo(175)
    expect(placement!.heightRatio).toBeCloseTo(placed.heightRatio)
    expect(signing.hasUnexported).toBe(true)
  })

  it('places a given signature without arming it', () => {
    const signing = useSigningStore()
    const source = signing.addSource('date', image)

    const placement = signing.placeSource(source.id, 1, rect)!

    expect(placement).toMatchObject({ sourceId: source.id, pageIndex: 1 })
    expect(signing.selectedId).toBe(placement.id)
    expect(signing.placeSource('missing', 0, rect)).toBeNull()
  })

  describe('applyToPages (PRD FR-10)', () => {
    // 150 × 50 points, 45 from the right and 92 from the bottom of an A4 page
    const corner = { xRatio: 400 / 595, yRatio: 700 / 842, widthRatio: 150 / 595, heightRatio: 50 / 842 }

    function setup() {
      const signing = useSigningStore()
      const source = signing.addSource('draw', image)
      const original = signing.placeSource(source.id, 0, corner)!
      return { signing, source, original }
    }

    it('copies to the chosen pages at the same corner margins and size', () => {
      const { signing, original } = setup()
      const pages = [a4, landscape, a4]

      expect(signing.applyToPages(original.id, [0, 1, 2], pages)).toBe(2)

      expect(signing.placements.map(p => p.pageIndex)).toEqual([0, 1, 2])
      const onLandscape = signing.placements[1]!
      expect(onLandscape.xRatio * 842).toBeCloseTo(842 - 45 - 150)
      expect(onLandscape.yRatio * 595).toBeCloseTo(595 - 92 - 50)
      expect(onLandscape.widthRatio * 842).toBeCloseTo(150)
      const groups = new Set(signing.placements.map(p => p.groupId))
      expect(groups.size).toBe(1)
      expect([...groups][0]).toBeDefined()
      expect(signing.selectedId).toBe(original.id)
    })

    it('skips pages that already show this signature', () => {
      const { signing, source, original } = setup()
      signing.placeSource(source.id, 2, rect)
      const other = signing.addSource('image', image)
      signing.placeSource(other.id, 1, rect)

      expect(signing.applyToPages(original.id, [0, 1, 2, 3], [a4, a4, a4, a4])).toBe(2)
      expect(signing.placements.filter(p => p.sourceId === source.id).map(p => p.pageIndex).sort()).toEqual([0, 1, 2, 3])
      // Nothing left to do: no copies and no new group
      expect(signing.applyToPages(original.id, [1, 3], [a4, a4, a4, a4])).toBe(0)
    })

    it('moving one copy leaves the others alone (PRD §10 case 22)', () => {
      const { signing, original } = setup()
      signing.applyToPages(original.id, [1, 2], [a4, a4, a4])
      const [, second, third] = signing.placements

      signing.update(second!.id, { ...rect })

      expect(signing.placements[1]).toMatchObject({ ...rect, groupId: second!.groupId })
      expect(signing.placements[2]).toEqual(third)
    })

    it('deletes a whole group, and only that group', () => {
      const { signing, source, original } = setup()
      signing.applyToPages(original.id, [1, 2], [a4, a4, a4])
      const byHand = signing.placeSource(source.id, 3, rect)!
      const later = signing.addSource('image', image)
      const otherBatch = signing.placeSource(later.id, 0, rect)!
      signing.applyToPages(otherBatch.id, [1], [a4, a4, a4, a4])
      signing.select(original.id)

      signing.removeGroup(original.groupId!)

      expect(signing.placements.map(p => p.id)).toEqual([byHand.id, otherBatch.id, signing.placements[2]!.id])
      expect(signing.placements.filter(p => p.sourceId === later.id)).toHaveLength(2)
      expect(signing.selectedId).toBeNull()
    })
  })
})
