<script setup lang="ts">
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PreviewPage } from '@/services/pdf-import'
import { ChevronDown, ChevronUp, MoveHorizontal, PanelLeft, ZoomIn, ZoomOut } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue'

import { clampZoom, fitWidthZoom, initialZoom, ZOOM_MAX, ZOOM_MIN, zoomIn, zoomOut } from '@/services/zoom'

import PdfPage from './PdfPage.vue'
import PdfThumbnailList from './PdfThumbnailList.vue'

const props = defineProps<{
  pdf: PDFDocumentProxy
  pages: readonly PreviewPage[]
}>()

defineSlots<{
  /** Drawn over each page, e.g. the signature layer */
  page?: (props: { pageIndex: number, page: PreviewPage }) => unknown
}>()

/** Horizontal padding around the pages, in CSS pixels (matches `px-6`) */
const PADDING = 24
const PAGE_TOP_CLEARANCE = 64

const scroller = useTemplateRef('scroller')
const column = useTemplateRef('column')

const zoom = ref(1)
const currentPage = ref(0)
const pageInput = ref('1')
/** Pages within one screen of the visible area; only these hold a rendered canvas */
const activePages = shallowRef(new Set<number>())

const wideScreen = () => window.matchMedia?.('(min-width: 768px)').matches ?? true
// Thumbnails sit beside the pages on wide screens and over them on phones
const sidebarOpen = ref(wideScreen())

function pageElement(index: number) {
  return column.value?.children[index] as HTMLElement | undefined
}

function availableWidth() {
  return (scroller.value?.clientWidth ?? 0) - 2 * PADDING
}

function pageWidths() {
  return props.pages.map(page => page.width)
}

/** The page crossing the upper third of the scroll area */
function updateCurrentPage() {
  const el = scroller.value
  if (!el)
    return
  const probe = el.scrollTop + el.clientHeight / 3
  let index = 0
  for (let i = 0; i < props.pages.length; i++) {
    if ((pageElement(i)?.offsetTop ?? Infinity) > probe)
      break
    index = i
  }
  currentPage.value = index
  pageInput.value = String(index + 1)
}

let scrollFrame = 0
function onScroll() {
  if (scrollFrame)
    return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    updateCurrentPage()
  })
}

function goToPage(index: number) {
  const target = pageElement(index)
  if (!scroller.value || !target)
    return
  scroller.value.scrollTo({ top: target.offsetTop - PAGE_TOP_CLEARANCE })
  currentPage.value = index
  pageInput.value = String(index + 1)
}

function selectThumbnail(index: number) {
  goToPage(index)
  if (!wideScreen())
    sidebarOpen.value = false
}

function onPageInput(event: Event) {
  const input = event.target as HTMLInputElement
  const page = Number.parseInt(input.value, 10)
  if (page >= 1 && page <= props.pages.length)
    goToPage(page - 1)
  else {
    pageInput.value = String(currentPage.value + 1)
    input.value = pageInput.value
    nextTick(() => {
      pageInput.value = String(currentPage.value + 1)
      input.value = pageInput.value
    })
  }
}

/** Changes the zoom and keeps the same spot of the current page in view. */
async function setZoom(next: number) {
  const value = clampZoom(next)
  const el = scroller.value
  const anchor = pageElement(currentPage.value)
  if (value === zoom.value || !el || !anchor) {
    zoom.value = value
    return
  }
  const within = (el.scrollTop - anchor.offsetTop) / anchor.offsetHeight
  zoom.value = value
  await nextTick()
  el.scrollTop = anchor.offsetTop + within * anchor.offsetHeight
}

let observer: IntersectionObserver | undefined

onMounted(() => {
  zoom.value = initialZoom(availableWidth(), pageWidths())

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
  }, { root: scroller.value, rootMargin: '100% 0px' })
  for (const element of column.value?.children ?? [])
    observer.observe(element)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div class="relative flex min-h-0">
    <PdfThumbnailList
      v-show="sidebarOpen"
      :pdf="pdf"
      :pages="pages"
      :current="currentPage"
      class="w-48 shrink-0 border-r border-sidebar-border max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-xl"
      @select="selectThumbnail"
    />
    <!-- Phones: the panel covers the pages; tapping beside it closes it -->
    <div v-if="sidebarOpen" class="absolute inset-0 z-10 bg-black/20 md:hidden" aria-hidden="true" @click="sidebarOpen = false" />

    <div class="relative min-w-0 flex-1">
      <div
        ref="scroller"
        class="absolute inset-0 overflow-auto overscroll-contain bg-workspace outline-none"
        tabindex="0"
        aria-label="PDF 预览"
        @scroll="onScroll"
      >
        <div ref="column" class="flex w-max min-w-full flex-col items-center gap-6 px-6 pt-16 pb-24 max-md:gap-4 max-md:px-3 max-md:pt-14 max-md:pb-20">
          <PdfPage
            v-for="(page, index) in pages"
            :key="index"
            :data-page-index="index"
            :pdf="pdf"
            :page-index="index"
            :page="page"
            :zoom="zoom"
            :active="activePages.has(index)"
          >
            <slot name="page" :page-index="index" :page="page" />
          </PdfPage>
        </div>
      </div>

      <!-- Floating controls: page navigation and zoom -->
      <div class="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-3">
        <div
          role="toolbar"
          aria-label="页面与缩放"
          class="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-xl border bg-background/90 p-1 text-sm shadow-lg shadow-black/10 backdrop-blur-md max-md:rounded-2xl max-md:p-0.5"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            :class="sidebarOpen && 'bg-accent text-accent-foreground'"
            :aria-label="sidebarOpen ? '隐藏缩略图' : '显示缩略图'"
            :title="sidebarOpen ? '隐藏缩略图' : '显示缩略图'"
            :aria-pressed="sidebarOpen"
            @click="sidebarOpen = !sidebarOpen"
          >
            <PanelLeft />
          </Button>

          <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <div class="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="上一页" title="上一页" :disabled="currentPage === 0" @click="goToPage(currentPage - 1)">
              <ChevronUp />
            </Button>
            <Input
              v-model="pageInput"
              type="number"
              inputmode="numeric"
              min="1"
              :max="pages.length"
              class="h-7 w-10 [appearance:textfield] rounded-md bg-background text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none max-md:h-11 max-md:min-w-11 pointer-coarse:h-11 pointer-coarse:min-w-11"
              aria-label="跳转到页码"
              @change="onPageInput"
            />
            <span class="px-1.5 text-muted-foreground tabular-nums">/ {{ pages.length }}</span>
            <Button variant="ghost" size="icon-sm" class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="下一页" title="下一页" :disabled="currentPage >= pages.length - 1" @click="goToPage(currentPage + 1)">
              <ChevronDown />
            </Button>
          </div>

          <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <div class="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="缩小" title="缩小" :disabled="zoom <= ZOOM_MIN" @click="setZoom(zoomOut(zoom))">
              <ZoomOut />
            </Button>
            <span class="w-11 text-center tabular-nums" aria-live="polite">{{ Math.round(zoom * 100) }}%</span>
            <Button variant="ghost" size="icon-sm" class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="放大" title="放大" :disabled="zoom >= ZOOM_MAX" @click="setZoom(zoomIn(zoom))">
              <ZoomIn />
            </Button>
            <Button variant="ghost" size="icon-sm" class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="适合宽度" title="适合宽度" @click="setZoom(fitWidthZoom(availableWidth(), pageWidths()))">
              <MoveHorizontal />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
