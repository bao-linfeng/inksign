<script setup lang="ts">
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PreviewPage } from '@/services/pdf-import'
import { computed, useTemplateRef } from 'vue'

import { usePageRender } from '@/composables/usePageRender'
import { planRender } from '@/services/pdf-renderer'

const props = defineProps<{
  pdf: PDFDocumentProxy
  pageIndex: number
  page: PreviewPage
  zoom: number
  active: boolean
}>()

const holder = useTemplateRef('holder')
const plan = computed(() => planRender(props.page, props.zoom, window.devicePixelRatio))
const { status } = usePageRender(holder, () => ({ pdf: props.pdf, pageIndex: props.pageIndex, plan: plan.value, active: props.active }))
</script>

<template>
  <section
    class="relative shrink-0 rounded-[2px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.04),0_2px_4px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.22)]"
    :style="{ width: `${plan.cssWidth}px`, height: `${plan.cssHeight}px` }"
    :aria-label="`第 ${pageIndex + 1} 页`"
  >
    <div ref="holder" class="absolute inset-0 overflow-hidden rounded-[2px]" />
    <div
      v-if="status !== 'rendered'"
      class="absolute inset-0 grid place-items-center text-sm text-muted-foreground/70"
    >
      {{ status === 'error' ? '此页无法显示' : `第 ${pageIndex + 1} 页` }}
    </div>
    <!-- Overlay in page coordinates (e.g. placed signatures); sized by percentages, so zoom-proof -->
    <slot />
  </section>
</template>
