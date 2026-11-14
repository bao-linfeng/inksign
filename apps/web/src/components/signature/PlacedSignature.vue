<script setup lang="ts">
import type { Corner, PageSize } from '@/services/placement'
import type { Placement, PlacementRect } from '@/types/signature'
import { X } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { useTemplateRef, watch } from 'vue'

import { moveBy, resizeFromCorner } from '@/services/placement'

const props = defineProps<{
  placement: Placement
  imageUrl: string
  /** What it is for screen readers: 签名 or 日期 */
  label?: string
  /** Visible page size, to keep the aspect ratio and to step in page units */
  page: PageSize
  selected: boolean
}>()

const emit = defineEmits<{
  select: []
  deselect: []
  update: [rect: PlacementRect]
  remove: []
}>()

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const cornerClass: Record<Corner, string> = {
  nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
}
const cornerLabel: Record<Corner, string> = { nw: '左上', ne: '右上', sw: '左下', se: '右下' }

/** Arrow keys move by 1 point, with Shift by 10 */
const KEY_STEP = 1
const KEY_STEP_LARGE = 10

const root = useTemplateRef('root')

interface Gesture {
  pointerId: number
  corner: Corner | null
  startX: number
  startY: number
  start: PlacementRect
  /** Displayed page size in CSS pixels, read once per gesture (zoom does not change during it) */
  width: number
  height: number
}
let gesture: Gesture | null = null

function rectOf(placement: Placement): PlacementRect {
  const { xRatio, yRatio, widthRatio, heightRatio } = placement
  return { xRatio, yRatio, widthRatio, heightRatio }
}

function begin(event: PointerEvent, corner: Corner | null) {
  if (event.button !== 0)
    return
  event.preventDefault()
  event.stopPropagation()
  emit('select')
  const layer = root.value?.parentElement?.getBoundingClientRect()
  if (!layer)
    return
  gesture = {
    pointerId: event.pointerId,
    corner,
    startX: event.clientX,
    startY: event.clientY,
    start: rectOf(props.placement),
    width: layer.width,
    height: layer.height,
  }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId)
    return
  const dx = (event.clientX - gesture.startX) / gesture.width
  const dy = (event.clientY - gesture.startY) / gesture.height
  emit('update', gesture.corner
    ? resizeFromCorner(gesture.start, gesture.corner, dx, dy, props.page)
    : moveBy(gesture.start, dx, dy))
}

function end(event: PointerEvent) {
  if (gesture?.pointerId === event.pointerId)
    gesture = null
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const move = moves[event.key]
  if (move) {
    event.preventDefault()
    emit('update', moveBy(rectOf(props.placement), move[0] / props.page.width, move[1] / props.page.height))
  }
  else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    emit('remove')
  }
  else if (event.key === 'Escape') {
    root.value?.blur()
    emit('deselect')
  }
}

// Keyboard users continue right where the signature was placed or picked
watch(() => props.selected, (selected) => {
  if (selected)
    root.value?.focus({ preventScroll: true })
}, { flush: 'post' })
</script>

<template>
  <div
    ref="root"
    class="group absolute touch-none outline-none select-none"
    :class="selected ? 'z-10 cursor-move' : 'cursor-pointer'"
    :style="{
      left: `${placement.xRatio * 100}%`,
      top: `${placement.yRatio * 100}%`,
      width: `${placement.widthRatio * 100}%`,
      height: `${placement.heightRatio * 100}%`,
    }"
    tabindex="0"
    role="button"
    :aria-label="`${label ?? '签名'}，第 ${placement.pageIndex + 1} 页${selected ? '，已选中：方向键移动，Delete 删除' : ''}`"
    :aria-pressed="selected"
    @pointerdown="begin($event, null)"
    @pointermove="onPointerMove"
    @pointerup="end"
    @pointercancel="end"
    @click.stop
    @keydown="onKeydown"
    @focus="emit('select')"
  >
    <img :src="imageUrl" alt="" draggable="false" class="pointer-events-none size-full">

    <div
      class="pointer-events-none absolute -inset-px rounded-[2px]"
      :class="selected
        ? 'ring-2 ring-primary'
        : 'ring-1 ring-transparent group-hover:ring-primary/50 group-focus-visible:ring-2 group-focus-visible:ring-ring'"
      aria-hidden="true"
    />

    <template v-if="selected">
      <span
        v-for="corner in CORNERS"
        :key="corner"
        class="absolute grid size-6 place-items-center"
        :class="cornerClass[corner]"
        :aria-label="`拖动${cornerLabel[corner]}角缩放`"
        @pointerdown="begin($event, corner)"
      >
        <span class="size-3 rounded-full border-2 border-primary bg-white shadow-sm" />
      </span>
      <Button
        size="icon-sm"
        class="absolute -top-9 right-0 rounded-full bg-destructive text-white shadow-md hover:bg-destructive/90 focus-visible:ring-ring max-md:-top-15 max-md:size-11 pointer-coarse:-top-15 pointer-coarse:size-11"
        :aria-label="`删除此${label ?? '签名'}`"
        title="删除"
        @pointerdown.stop
        @click.stop="emit('remove')"
      >
        <X class="size-3.5" />
      </Button>
    </template>
  </div>
</template>
