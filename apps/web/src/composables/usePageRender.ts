import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Ref } from 'vue'
import type { RenderPlan } from '@/services/pdf-renderer'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { isRenderingCancelled, renderToCanvas } from '@/services/pdf-renderer'

export interface PageRenderSource {
  pdf: PDFDocumentProxy
  pageIndex: number
  plan: RenderPlan
  /** Near the visible area; only then is the page rendered (PRD FR-02) */
  active: boolean
}

/**
 * Renders a page into `holder` while it is active and frees the canvas when it is not. A new
 * canvas replaces the old one only once it is ready, so zooming never flashes a blank page.
 */
export function usePageRender(holder: Readonly<Ref<HTMLElement | null>>, source: () => PageRenderSource) {
  const status = ref<'blank' | 'rendered' | 'error'>('blank')

  let task: RenderTask | null = null
  let renderedSize = ''
  // Bumped by every update, so a render that was overtaken does not touch the page
  let generation = 0

  /** Releases canvas memory right away; Safari otherwise keeps it until garbage collection. */
  function freeCanvases() {
    for (const canvas of holder.value?.querySelectorAll('canvas') ?? []) {
      canvas.width = 0
      canvas.height = 0
    }
    holder.value?.replaceChildren()
  }

  async function update() {
    const current = ++generation
    task?.cancel()
    task = null

    const { pdf, pageIndex, plan, active } = source()
    if (!active) {
      freeCanvases()
      renderedSize = ''
      status.value = 'blank'
      return
    }

    const size = `${plan.pixelWidth}x${plan.pixelHeight}`
    if (size === renderedSize)
      return

    try {
      const page = await pdf.getPage(pageIndex + 1)
      if (current !== generation)
        return
      const rendering = renderToCanvas(page, plan)
      task = rendering.task
      await rendering.task.promise
      if (current !== generation)
        return
      rendering.canvas.className = 'absolute inset-0 size-full'
      freeCanvases()
      holder.value?.append(rendering.canvas)
      renderedSize = size
      status.value = 'rendered'
    }
    catch (error) {
      if (current === generation && !isRenderingCancelled(error))
        status.value = 'error'
    }
  }

  watch(source, update)
  onMounted(update)
  onBeforeUnmount(() => {
    generation++
    task?.cancel()
    freeCanvases()
  })

  return { status }
}
