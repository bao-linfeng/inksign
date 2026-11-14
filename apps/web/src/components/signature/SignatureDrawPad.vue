<script setup lang="ts">
import type { SignatureImage } from '@/services/signature-image'
import { Check, Eraser, Maximize2, Smartphone } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/radio-group'
import SignaturePad from 'signature_pad'
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import { canvasToPng, INK_COLORS as COLORS, trimCanvas } from '@/services/signature-image'

const emit = defineEmits<{ change: [empty: boolean] }>()
const expanded = defineModel<boolean>('expanded', { default: false })

/** CSS pixels kept around the strokes when trimming (PRD FR-03: 8–16 px) */
const TRIM_PADDING = 12

const canvas = useTemplateRef('canvas')
const color = ref<string>(COLORS[0].value)
const empty = ref(true)
const drawing = ref(false)

let pad: SignaturePad | undefined
let resizeObserver: ResizeObserver | undefined
let capturedPointer: number | undefined
/** Backing-store scale: at least 2× so the signature stays sharp when zoomed in the PDF */
let ratio = 2

/** Matches the backing store to the displayed size, keeping what was drawn. */
function fitCanvas() {
  const el = canvas.value
  if (drawing.value || !el || !pad || el.offsetWidth === 0 || el.offsetHeight === 0)
    return
  ratio = Math.max(window.devicePixelRatio || 1, 2)
  const width = Math.round(el.offsetWidth * ratio)
  const height = Math.round(el.offsetHeight * ratio)
  if (el.width === width && el.height === height)
    return
  let strokes = pad.toData()
  const points = strokes.flatMap(group => group.points)
  if (points.length) {
    const { minX, maxX, minY, maxY } = points.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
    const padding = Math.max(...strokes.map(group => group.maxWidth), 3) + 2
    const scale = Math.min(1, (el.offsetWidth - 2 * padding) / (maxX - minX || 1), (el.offsetHeight - 2 * padding) / (maxY - minY || 1))
    const dx = Math.max(padding - minX * scale, Math.min(0, el.offsetWidth - padding - maxX * scale))
    const dy = Math.max(padding - minY * scale, Math.min(0, el.offsetHeight - padding - maxY * scale))
    strokes = strokes.map(group => ({
      ...group,
      minWidth: group.minWidth * scale,
      maxWidth: group.maxWidth * scale,
      dotSize: group.dotSize * scale,
      points: group.points.map(point => ({ ...point, x: point.x * scale + dx, y: point.y * scale + dy })),
    }))
  }
  el.width = width
  el.height = height
  el.getContext('2d')!.scale(ratio, ratio)
  pad.clear()
  pad.fromData(strokes)
}

function preventSelection(event: Event) {
  if (drawing.value)
    event.preventDefault()
}

function beginStroke(event: Event) {
  drawing.value = true
  window.getSelection()?.removeAllRanges()
  const source = (event as CustomEvent<{ event: Event }>).detail.event
  if (window.PointerEvent && source instanceof PointerEvent && canvas.value?.setPointerCapture) {
    canvas.value.setPointerCapture(source.pointerId)
    capturedPointer = source.pointerId
  }
}

function releasePointer() {
  if (capturedPointer !== undefined && canvas.value?.hasPointerCapture(capturedPointer))
    canvas.value.releasePointerCapture(capturedPointer)
  capturedPointer = undefined
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
  pad = new SignaturePad(canvas.value!, { penColor: color.value, minWidth: 1.5, maxWidth: 1.5, dotSize: 1.5, velocityFilterWeight: 0.6, throttle: 0, minDistance: 1 })
  pad.addEventListener('beginStroke', beginStroke)
  pad.addEventListener('endStroke', () => {
    drawing.value = false
    releasePointer()
    fitCanvas()
    empty.value = pad!.isEmpty()
    emit('change', empty.value)
  })
  document.addEventListener('selectstart', preventSelection, true)
  fitCanvas()
  // The dialog animates in, so the size is known only after the first layout
  resizeObserver = new ResizeObserver(fitCanvas)
  resizeObserver.observe(canvas.value!)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('selectstart', preventSelection, true)
  releasePointer()
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
  <div class="signature-draw-pad flex flex-col gap-3" :class="expanded && 'min-h-0 flex-1'">
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div v-if="expanded" class="min-w-0">
        <p class="font-medium">
          手写签名
        </p>
        <p class="signature-rotate-hint flex items-center gap-1 text-xs text-muted-foreground">
          <Smartphone class="size-3.5 shrink-0" aria-hidden="true" />
          将手机横过来，书写更舒展
        </p>
      </div>
      <p v-else class="text-xs text-muted-foreground">
        横屏书写更舒展
      </p>
      <Button class="signature-mode-button relative shrink-0" :variant="expanded ? 'default' : 'outline'" size="sm" :aria-expanded="expanded" :disabled="drawing" @click="expanded = !expanded">
        <Check v-if="expanded" aria-hidden="true" />
        <Maximize2 v-else aria-hidden="true" />
        {{ expanded ? '完成书写' : '全屏书写' }}
      </Button>
    </div>
    <div class="relative overflow-hidden rounded-lg border bg-white" :class="expanded && 'min-h-0 flex-1'">
      <canvas
        ref="canvas"
        class="block w-full touch-none select-none"
        :class="expanded ? 'absolute inset-0 h-full' : 'h-64 sm:h-60'"
        aria-label="手写签名区域"
        @touchstart.prevent
        @touchmove.prevent
        @contextmenu.prevent
        @selectstart.prevent
      />
      <!-- Signing line as a guide; not part of the image -->
      <div class="pointer-events-none absolute inset-x-8 bottom-12 border-b border-dashed border-border" aria-hidden="true" />
      <p v-if="empty" class="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
        在此处手写签名
      </p>
    </div>

    <div class="flex shrink-0 items-center justify-between">
      <RadioGroup v-model="color" class="flex items-center gap-2" aria-label="笔迹颜色" :disabled="drawing">
        <RadioGroupItem
          v-for="option in COLORS"
          :key="option.value"
          :value="option.value"
          :aria-label="option.name"
          :title="option.name"
          class="size-11 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="color === option.value && 'ring-2 ring-primary'"
          :style="{ backgroundColor: option.value }"
        />
      </RadioGroup>
      <Button class="h-11" variant="ghost" size="sm" :disabled="empty || drawing" @click="clear">
        <Eraser aria-hidden="true" />
        清空
      </Button>
    </div>
  </div>
</template>

<style scoped>
.signature-draw-pad {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.signature-mode-button {
  height: 2rem;
  font-size: 0.875rem;
}

@media (pointer: coarse) {
  .signature-mode-button::after {
    position: absolute;
    inset: -6px 0;
    content: '';
  }
}

@media (orientation: landscape) {
  .signature-rotate-hint {
    display: none;
  }
}
</style>
