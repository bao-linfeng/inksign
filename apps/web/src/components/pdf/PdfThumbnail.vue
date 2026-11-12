<script setup lang="ts">
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PreviewPage } from '@/services/pdf-import'
import { computed, useTemplateRef } from 'vue'

import { usePageRender } from '@/composables/usePageRender'
import { CSS_PX_PER_POINT, planRender } from '@/services/pdf-renderer'

const props = defineProps<{
  pdf: PDFDocumentProxy
  pageIndex: number
  page: PreviewPage
  active: boolean
  current: boolean
}>()

defineEmits<{ select: [] }>()

/** Every thumbnail fits this box, portrait or landscape */
const BOX = { width: 120, height: 160 }

const holder = useTemplateRef('holder')
const plan = computed(() => {
  const zoom = Math.min(BOX.width / props.page.width, BOX.height / props.page.height) / CSS_PX_PER_POINT
  return planRender(props.page, zoom, window.devicePixelRatio)
})
usePageRender(holder, () => ({ pdf: props.pdf, pageIndex: props.pageIndex, plan: plan.value, active: props.active }))
</script>

<template>
  <button
    type="button"
    class="group flex w-full flex-col items-center gap-1.5 rounded-lg px-2 pt-2.5 pb-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :aria-label="`第 ${pageIndex + 1} 页`"
    :aria-current="current ? 'page' : undefined"
    @click="$emit('select')"
  >
    <span
      class="relative block bg-white transition-shadow"
      :class="current
        ? 'shadow-md ring-2 ring-primary ring-offset-2 ring-offset-sidebar'
        : 'shadow-sm ring-1 ring-black/10 group-hover:shadow-md group-hover:ring-black/20'"
      :style="{ width: `${plan.cssWidth}px`, height: `${plan.cssHeight}px` }"
    >
      <span ref="holder" class="absolute inset-0 overflow-hidden" />
    </span>
    <span
      class="min-w-6 rounded-full px-1.5 text-xs tabular-nums"
      :class="current ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground'"
    >
      {{ pageIndex + 1 }}
    </span>
  </button>
</template>
