import type { DateField } from '@/services/date-renderer'
import type { PageSize } from '@/services/placement'
import type { SignatureImage } from '@/services/signature-image'
import type { Placement, PlacementRect, SignatureSource } from '@/types/signature'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { anchoredRect } from '@/services/batch-placement'
import { refitAspect } from '@/services/placement'

let lastId = 0
// Not crypto.randomUUID(): it is missing on plain-HTTP origins such as a LAN test server
const newId = (prefix: string) => `${prefix}${++lastId}`

/**
 * Signatures of this session and where they are placed (PRD FR-05). Memory only: closing the page
 * or opening another PDF discards them (FR-07).
 */
export const useSigningStore = defineStore('signing', () => {
  const sources = ref<SignatureSource[]>([])
  const placements = ref<Placement[]>([])
  const selectedId = ref<string | null>(null)
  /** The signature the next click on a page places */
  const armedSourceId = ref<string | null>(null)
  /** Placements changed since the last export (PRD §9: warn before discarding them) */
  const unexported = ref(false)

  /** Signatures placed but not exported yet: worth a warning before they are discarded */
  const hasUnexported = computed(() => unexported.value && placements.value.length > 0)

  const selected = computed(() => placements.value.find(p => p.id === selectedId.value) ?? null)

  function sourceOf(id: string) {
    return sources.value.find(source => source.id === id)
  }

  const previewUrlOf = (image: SignatureImage) => URL.createObjectURL(new Blob([image.pngBytes as BlobPart], { type: 'image/png' }))

  function addSource(kind: SignatureSource['kind'], image: SignatureImage, date?: DateField): SignatureSource {
    return pushSource(kind, image, date && { date })
  }

  function pushSource(kind: SignatureSource['kind'], image: SignatureImage, extra?: Pick<SignatureSource, 'date' | 'libraryId'>) {
    const source: SignatureSource = {
      id: newId('s'),
      kind,
      pngBytes: image.pngBytes,
      previewUrl: previewUrlOf(image),
      naturalWidth: image.width,
      naturalHeight: image.height,
      ...extra,
    }
    sources.value.push(source)
    return source
  }

  /** A library signature (PRD FR-08) as a session signature; using it twice reuses the first one. */
  function addFromLibrary(libraryId: string, image: SignatureImage): SignatureSource {
    return sources.value.find(source => source.libraryId === libraryId) ?? pushSource('image', image, { libraryId })
  }

  /**
   * Swaps the image of a signature, e.g. a date whose value or format changed (PRD FR-09): every
   * placement of it follows, keeping its height and centre. `pages` are the visible page sizes.
   */
  function replaceImage(id: string, image: SignatureImage, pages: readonly PageSize[], date?: DateField) {
    const index = sources.value.findIndex(s => s.id === id)
    const source = sources.value[index]
    if (!source)
      return
    URL.revokeObjectURL(source.previewUrl)
    sources.value[index] = {
      ...source,
      pngBytes: image.pngBytes,
      previewUrl: previewUrlOf(image),
      naturalWidth: image.width,
      naturalHeight: image.height,
      ...(date && { date }),
    }
    const aspect = image.width / image.height
    placements.value = placements.value.map((placement) => {
      const page = pages[placement.pageIndex]
      return placement.sourceId === id && page ? { ...placement, ...refitAspect(placement, page, aspect) } : placement
    })
    if (placements.value.some(p => p.sourceId === id))
      unexported.value = true
  }

  /** Removes a signature together with every placement of it. */
  function removeSource(id: string) {
    const source = sourceOf(id)
    if (!source)
      return
    URL.revokeObjectURL(source.previewUrl)
    sources.value = sources.value.filter(s => s.id !== id)
    const before = placements.value.length
    placements.value = placements.value.filter(p => p.sourceId !== id)
    if (placements.value.length !== before)
      unexported.value = true
    if (armedSourceId.value === id)
      armedSourceId.value = null
    if (selectedId.value && !selected.value)
      selectedId.value = null
  }

  function arm(id: string | null) {
    armedSourceId.value = id
    if (id)
      selectedId.value = null
  }

  /** Places the armed signature and selects it; placing ends the placing mode. */
  function place(pageIndex: number, rect: PlacementRect): Placement | null {
    const sourceId = armedSourceId.value
    if (!sourceId)
      return null
    const placement = placeSource(sourceId, pageIndex, rect)
    armedSourceId.value = null
    return placement
  }

  /** Places a given signature without arming it, e.g. a date under a signature, and selects it. */
  function placeSource(sourceId: string, pageIndex: number, rect: PlacementRect): Placement | null {
    if (!sourceOf(sourceId))
      return null
    const placement: Placement = { id: newId('p'), sourceId, pageIndex, ...rect }
    placements.value.push(placement)
    selectedId.value = placement.id
    unexported.value = true
    return placement
  }

  /**
   * Copies a placement to `pageIndexes` at the same distance from its nearest page corner (PRD
   * FR-10). Pages that already show this signature are skipped. The copies and the original share a
   * `groupId`, so they can be deleted together; each one still moves on its own. Returns how many
   * copies were made.
   */
  function applyToPages(id: string, pageIndexes: readonly number[], pages: readonly PageSize[]) {
    const original = placements.value.find(p => p.id === id)
    const from = original && pages[original.pageIndex]
    if (!original || !from)
      return 0
    const taken = new Set(placements.value.filter(p => p.sourceId === original.sourceId).map(p => p.pageIndex))
    const targets = pageIndexes.filter(index => !taken.has(index) && pages[index])
    if (!targets.length)
      return 0
    const groupId = original.groupId ?? newId('g')
    original.groupId = groupId
    for (const pageIndex of targets) {
      const rect = anchoredRect(original, from, pages[pageIndex]!)
      placements.value.push({ id: newId('p'), sourceId: original.sourceId, pageIndex, ...rect, groupId })
    }
    unexported.value = true
    return targets.length
  }

  /** Deletes every placement of a batch (FR-10), leaving the ones placed by hand. */
  function removeGroup(groupId: string) {
    placements.value = placements.value.filter(p => p.groupId !== groupId)
    if (selectedId.value && !selected.value)
      selectedId.value = null
    unexported.value = true
  }

  function update(id: string, rect: PlacementRect) {
    const index = placements.value.findIndex(p => p.id === id)
    if (index < 0)
      return
    placements.value[index] = { ...placements.value[index]!, ...rect }
    unexported.value = true
  }

  function remove(id: string) {
    placements.value = placements.value.filter(p => p.id !== id)
    if (selectedId.value === id)
      selectedId.value = null
    unexported.value = true
  }

  function select(id: string | null) {
    selectedId.value = id
  }

  function markExported() {
    unexported.value = false
  }

  /** Forgets everything, e.g. when another PDF is opened. */
  function reset() {
    for (const source of sources.value)
      URL.revokeObjectURL(source.previewUrl)
    sources.value = []
    placements.value = []
    selectedId.value = null
    armedSourceId.value = null
    unexported.value = false
  }

  return {
    sources,
    placements,
    selectedId,
    selected,
    armedSourceId,
    hasUnexported,
    sourceOf,
    addSource,
    addFromLibrary,
    replaceImage,
    removeSource,
    arm,
    place,
    placeSource,
    applyToPages,
    update,
    remove,
    removeGroup,
    select,
    markExported,
    reset,
  }
})
