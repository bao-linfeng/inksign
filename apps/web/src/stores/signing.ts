import type { SignatureImage } from '@/services/signature-image'
import type { Placement, PlacementRect, SignatureSource } from '@/types/signature'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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

  function addSource(kind: SignatureSource['kind'], image: SignatureImage): SignatureSource {
    const source: SignatureSource = {
      id: newId('s'),
      kind,
      pngBytes: image.pngBytes,
      previewUrl: URL.createObjectURL(new Blob([image.pngBytes as BlobPart], { type: 'image/png' })),
      naturalWidth: image.width,
      naturalHeight: image.height,
    }
    sources.value.push(source)
    return source
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
    if (!sourceId || !sourceOf(sourceId))
      return null
    const placement: Placement = { id: newId('p'), sourceId, pageIndex, ...rect }
    placements.value.push(placement)
    armedSourceId.value = null
    selectedId.value = placement.id
    unexported.value = true
    return placement
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
    removeSource,
    arm,
    place,
    update,
    remove,
    select,
    markExported,
    reset,
  }
})
