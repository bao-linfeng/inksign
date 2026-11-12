<script setup lang="ts">
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PreviewPage } from '@/services/pdf-import'
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import PdfThumbnail from './PdfThumbnail.vue'

const props = defineProps<{
  pdf: PDFDocumentProxy
  pages: readonly PreviewPage[]
  current: number
}>()

defineEmits<{ select: [index: number] }>()

const list = useTemplateRef('list')
/** Thumbnails within half a panel of the visible area */
const activePages = shallowRef(new Set<number>())

// Keep the current page's thumbnail in view while the document scrolls
watch(() => props.current, (index) => {
  list.value?.children[index]?.scrollIntoView({ block: 'nearest' })
})

let observer: IntersectionObserver | undefined

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    const next = new Set(activePages.value)
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.pageIndex)
      if (entry.isIntersecting)
        next.add(index)
      else
        next.delete(index)
    }
    activePages.value = next
  }, { root: list.value?.parentElement, rootMargin: '50% 0px' })
  for (const element of list.value?.children ?? [])
    observer.observe(element)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <nav aria-label="页面缩略图" class="flex min-h-0 flex-col bg-sidebar">
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border px-4 text-xs text-muted-foreground">
      <span class="font-medium text-sidebar-foreground">页面</span>
      <span class="tabular-nums">{{ current + 1 }} / {{ pages.length }}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <ol ref="list" class="flex flex-col gap-1">
        <li v-for="(page, index) in pages" :key="index" :data-page-index="index">
          <PdfThumbnail
            :pdf="pdf"
            :page-index="index"
            :page="page"
            :active="activePages.has(index)"
            :current="index === current"
            @select="$emit('select', index)"
          />
        </li>
      </ol>
    </div>
  </nav>
</template>
