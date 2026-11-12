<script setup lang="ts">
import type { PreviewPage } from '@/services/pdf-import'
import type { PlacementRect } from '@/types/signature'
import { computed, ref } from 'vue'

import { DATE_PLACED_HEIGHT } from '@/services/date-renderer'
import { initialRect } from '@/services/placement'
import { useSigningStore } from '@/stores/signing'

import PlacedSignature from './PlacedSignature.vue'

const props = defineProps<{
  pageIndex: number
  page: PreviewPage
}>()

const signing = useSigningStore()

const pageSize = computed(() => ({ width: props.page.width, height: props.page.height }))
const placements = computed(() => signing.placements.filter(p => p.pageIndex === props.pageIndex))
const armed = computed(() => (signing.armedSourceId ? signing.sourceOf(signing.armedSourceId) : undefined))

/** Where the armed signature would land, shown under the mouse before clicking */
const ghost = ref<PlacementRect | null>(null)

function rectAt(event: MouseEvent): PlacementRect | null {
  const source = armed.value
  if (!source)
    return null
  const layer = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const center = { x: (event.clientX - layer.left) / layer.width, y: (event.clientY - layer.top) / layer.height }
  const aspect = source.naturalWidth / source.naturalHeight
  // Dates are sized like text rather than like a signature
  return initialRect(pageSize.value, aspect, center, source.kind === 'date' ? DATE_PLACED_HEIGHT * aspect : undefined)
}

function onClick(event: MouseEvent) {
  const rect = rectAt(event)
  if (rect)
    signing.place(props.pageIndex, rect)
  else
    signing.select(null)
  ghost.value = null
}

function onPointerMove(event: PointerEvent) {
  ghost.value = event.pointerType === 'mouse' ? rectAt(event) : null
}
</script>

<template>
  <div
    class="absolute inset-0"
    :class="armed && 'cursor-crosshair'"
    @click="onClick"
    @pointermove="onPointerMove"
    @pointerleave="ghost = null"
  >
    <img
      v-if="armed && ghost"
      :src="armed.previewUrl"
      alt=""
      class="pointer-events-none absolute opacity-50 outline-2 outline-primary/60 outline-dashed"
      :style="{
        left: `${ghost.xRatio * 100}%`,
        top: `${ghost.yRatio * 100}%`,
        width: `${ghost.widthRatio * 100}%`,
        height: `${ghost.heightRatio * 100}%`,
      }"
    >
    <PlacedSignature
      v-for="placement in placements"
      :key="placement.id"
      :placement="placement"
      :image-url="signing.sourceOf(placement.sourceId)?.previewUrl ?? ''"
      :label="signing.sourceOf(placement.sourceId)?.kind === 'date' ? '日期' : '签名'"
      :page="pageSize"
      :selected="placement.id === signing.selectedId"
      @select="signing.select(placement.id)"
      @deselect="signing.select(null)"
      @update="signing.update(placement.id, $event)"
      @remove="signing.remove(placement.id)"
    />
  </div>
</template>
