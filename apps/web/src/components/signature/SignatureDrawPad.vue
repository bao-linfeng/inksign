<script setup lang="ts">
import type { SignatureImage } from '@/services/signature-image'
import { Eraser } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import SignaturePad from 'signature_pad'
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import { canvasToPng, trimCanvas } from '@/services/signature-image'

const emit = defineEmits<{ change: [empty: boolean] }>()

/** Ink colours common on contracts */
const COLORS = [
  { name: '黑色', value: '#1a1a1a' },
  { name: '蓝色', value: '#1d3b8f' },
] as const

/** CSS pixels kept around the strokes when trimming (PRD FR-03: 8–16 px) */
const TRIM_PADDING = 12

const canvas = useTemplateRef('canvas')
const color = ref<string>(COLORS[0].value)
const empty = ref(true)

let pad: SignaturePad | undefined
let resizeObserver: ResizeObserver | undefined
/** Backing-store scale: at least 2× so the signature stays sharp when zoomed in the PDF */
let ratio = 2

/** Matches the backing store to the displayed size, keeping what was drawn. */
function fitCanvas() {
  const el = canvas.value
  if (!el || !pad || el.offsetWidth === 0)
    return
  ratio = Math.max(window.devicePixelRatio || 1, 2)
  const width = Math.round(el.offsetWidth * ratio)
  const height = Math.round(el.offsetHeight * ratio)
  if (el.width === width && el.height === height)
    return
  const strokes = pad.toData()
  el.width = width
  el.height = height
  el.getContext('2d')!.scale(ratio, ratio)
  pad.clear()
  pad.fromData(strokes)
}

function clear() {
  pad?.clear()
  empty.value = true
  emit('change', true)
}

watch(color, (value) => {
  if (!pad)
    return
  pad.penColor = value
  // Recolour what is already drawn, so one signature has one colour
  pad.fromData(pad.toData().map(group => ({ ...group, penColor: value })))
})

onMounted(() => {
  pad = new SignaturePad(canvas.value!, { penColor: color.value, minWidth: 0.9, maxWidth: 3, velocityFilterWeight: 0.6 })
  pad.addEventListener('endStroke', () => {
    empty.value = pad!.isEmpty()
    emit('change', empty.value)
  })
  fitCanvas()
  // The dialog animates in, so the size is known only after the first layout
  resizeObserver = new ResizeObserver(fitCanvas)
  resizeObserver.observe(canvas.value!)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  pad?.off()
})

/** The drawing as a trimmed transparent PNG, or `null` when nothing was drawn. */
async function toImage(): Promise<SignatureImage | null> {
  if (!pad || pad.isEmpty() || !canvas.value)
    return null
  const trimmed = trimCanvas(canvas.value, Math.round(TRIM_PADDING * ratio))
  if (!trimmed)
    return null
  return { pngBytes: await canvasToPng(trimmed), width: trimmed.width, height: trimmed.height }
}

defineExpose({ toImage })
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="relative overflow-hidden rounded-lg border bg-white">
      <canvas
        ref="canvas"
        class="block h-52 w-full touch-none select-none"
        aria-label="手写签名区域"
      />
      <!-- Signing line as a guide; not part of the image -->
      <div class="pointer-events-none absolute inset-x-8 bottom-12 border-b border-dashed border-border" aria-hidden="true" />
      <p v-if="empty" class="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground/70">
        在此处手写签名
      </p>
    </div>

    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2" role="radiogroup" aria-label="笔迹颜色">
        <button
          v-for="option in COLORS"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="color === option.value"
          :aria-label="option.name"
          :title="option.name"
          class="size-7 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="color === option.value && 'ring-2 ring-primary'"
          :style="{ backgroundColor: option.value }"
          @click="color = option.value"
        />
      </div>
      <Button variant="ghost" size="sm" :disabled="empty" @click="clear">
        <Eraser aria-hidden="true" />
        清空
      </Button>
    </div>
  </div>
</template>
