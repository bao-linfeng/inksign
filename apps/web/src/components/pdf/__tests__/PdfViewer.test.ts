// @vitest-environment happy-dom
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PreviewPage } from '@/services/pdf-import'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CSS_PX_PER_POINT } from '@/services/pdf-renderer'

import PdfViewer from '../PdfViewer.vue'

/** IntersectionObserver driven by the test: `report(i, true)` puts item `i` near the visible area. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  targets: Element[] = []
  constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit = {}) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.push(target)
  }

  disconnect() {}

  report(index: number, isIntersecting: boolean) {
    const entry = { target: this.targets[index]!, isIntersecting } as IntersectionObserverEntry
    this.callback([entry], this as unknown as IntersectionObserver)
  }
}

/** The observer of the main pages or of the thumbnail panel */
function observer(of: 'pages' | 'thumbnails') {
  return FakeIntersectionObserver.instances.find((instance) => {
    const root = instance.options.root as HTMLElement
    return of === 'pages' ? root.getAttribute('aria-label') === 'PDF 预览' : !!root.closest('nav')
  })!
}

const geometry = { view: [0, 0, 595, 842] as const, rotation: 0 as const }
const pages: PreviewPage[] = [
  { geometry, width: 595, height: 842 },
  { geometry, width: 842, height: 595 },
  { geometry, width: 595, height: 842 },
]

function fakePdf() {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  const pdf = {
    getPage: vi.fn(async (number: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: pages[number - 1]!.width * scale, height: pages[number - 1]!.height * scale }),
      render,
    })),
  } as unknown as PDFDocumentProxy
  return { pdf, render }
}

function pageSizes(wrapper: ReturnType<typeof mount>) {
  // Rounded: the browser serializes the CSS lengths with limited precision
  return wrapper.findAll('section').map(section => [section.element.style.width, section.element.style.height].map(length => Math.round(Number.parseFloat(length))))
}

const currentThumbnail = (wrapper: ReturnType<typeof mount>) => wrapper.get('nav [aria-current="page"]').text()

describe('pdfViewer', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lays out every page at its own size and orientation', () => {
    const wrapper = mount(PdfViewer, { props: { pdf: fakePdf().pdf, pages } })
    const px = (points: number) => Math.round(points * CSS_PX_PER_POINT)

    expect(pageSizes(wrapper)).toEqual([[px(595), px(842)], [px(842), px(595)], [px(595), px(842)]])
    expect(wrapper.text()).toContain('/ 3')
  })

  it('wraps the toolbar without splitting page and zoom control groups', () => {
    const wrapper = mount(PdfViewer, { props: { pdf: fakePdf().pdf, pages } })
    const toolbar = wrapper.get('[role="toolbar"]')
    expect(toolbar.classes()).toEqual(expect.arrayContaining(['max-w-full', 'flex-wrap']))
    const previous = toolbar.get('[aria-label="上一页"]').element
    const next = toolbar.get('[aria-label="下一页"]').element
    const zoomOut = toolbar.get('[aria-label="缩小"]').element
    const fit = toolbar.get('[aria-label="适合宽度"]').element
    expect(previous.parentElement).toBe(next.parentElement)
    expect(zoomOut.parentElement).toBe(fit.parentElement)
    expect(previous.parentElement).not.toBe(zoomOut.parentElement)
    expect(wrapper.get('section').element.parentElement?.classList.contains('pt-16')).toBe(true)
  })

  it('renders only pages near the visible area (FR-02)', async () => {
    const { pdf, render } = fakePdf()
    const wrapper = mount(PdfViewer, { props: { pdf, pages } })
    await flushPromises()
    expect(render).not.toHaveBeenCalled()

    observer('pages').report(1, true)
    await flushPromises()

    expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(2)
    expect(wrapper.findAll('section')[1]!.find('canvas').exists()).toBe(true)
    expect(wrapper.findAll('section')[0]!.find('canvas').exists()).toBe(false)

    // Leaving the area frees the canvas again
    observer('pages').report(1, false)
    await flushPromises()
    expect(wrapper.findAll('section')[1]!.find('canvas').exists()).toBe(false)
  })

  it('renders thumbnails lazily as well', async () => {
    const { pdf, render } = fakePdf()
    const wrapper = mount(PdfViewer, { props: { pdf, pages } })

    observer('thumbnails').report(2, true)
    await flushPromises()

    expect(render).toHaveBeenCalledOnce()
    const thumbnails = wrapper.findAll('nav li')
    expect(thumbnails[2]!.find('canvas').exists()).toBe(true)
    expect(thumbnails[0]!.find('canvas').exists()).toBe(false)
  })

  it('zooms in steps and re-renders the visible pages', async () => {
    const { pdf, render } = fakePdf()
    const wrapper = mount(PdfViewer, { props: { pdf, pages } })
    observer('pages').report(0, true)
    await flushPromises()

    await wrapper.get('[aria-label="放大"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('125%')
    expect(pageSizes(wrapper)[0]).toEqual([Math.round(595 * 1.25 * CSS_PX_PER_POINT), Math.round(842 * 1.25 * CSS_PX_PER_POINT)])
    expect(render).toHaveBeenCalledTimes(2)

    await wrapper.get('[aria-label="缩小"]').trigger('click')
    await wrapper.get('[aria-label="缩小"]').trigger('click')
    expect(wrapper.text()).toContain('75%')
  })

  it('navigates with the page field, the arrows and the thumbnails', async () => {
    const wrapper = mount(PdfViewer, { props: { pdf: fakePdf().pdf, pages } })
    const scroller = wrapper.get('[aria-label="PDF 预览"]').element as HTMLElement
    scroller.scrollTo = vi.fn()
    expect(currentThumbnail(wrapper)).toBe('1')
    expect((wrapper.get('input[aria-label="跳转到页码"]').element as HTMLInputElement).value).toBe('1')
    expect(wrapper.get('[aria-label="上一页"]').attributes('disabled')).toBeDefined()

    await wrapper.get('input[aria-label="跳转到页码"]').setValue('3')
    expect(scroller.scrollTo).toHaveBeenCalledOnce()
    expect(currentThumbnail(wrapper)).toBe('3')
    expect(wrapper.get('[aria-label="下一页"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[aria-label="上一页"]').trigger('click')
    expect(currentThumbnail(wrapper)).toBe('2')

    await wrapper.get('nav [aria-label="第 1 页"]').trigger('click')
    expect(currentThumbnail(wrapper)).toBe('1')

    // Out-of-range input is reset to the current page
    await wrapper.get('input[aria-label="跳转到页码"]').setValue('9')
    expect((wrapper.get('input[aria-label="跳转到页码"]').element as HTMLInputElement).value).toBe('1')
  })

  it('keeps the page field synchronized while scrolling', async () => {
    const wrapper = mount(PdfViewer, { props: { pdf: fakePdf().pdf, pages } })
    const scroller = wrapper.get('[aria-label="PDF 预览"]').element as HTMLElement
    const pageElements = wrapper.findAll('section').map(section => section.element as HTMLElement)

    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 })
    pageElements.forEach((element, index) => {
      Object.defineProperty(element, 'offsetTop', { configurable: true, value: index * 900 })
    })
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 900 })

    scroller.dispatchEvent(new Event('scroll'))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await wrapper.vm.$nextTick()

    expect(currentThumbnail(wrapper)).toBe('2')
    expect((wrapper.get('input[aria-label="跳转到页码"]').element as HTMLInputElement).value).toBe('2')
  })

  it('hides and shows the thumbnail panel', async () => {
    const wrapper = mount(PdfViewer, { props: { pdf: fakePdf().pdf, pages } })
    const panel = () => wrapper.get('nav[aria-label="页面缩略图"]').element as HTMLElement

    expect(panel().style.display).toBe('')
    await wrapper.get('[aria-label="隐藏缩略图"]').trigger('click')
    expect(panel().style.display).toBe('none')
    await wrapper.get('[aria-label="显示缩略图"]').trigger('click')
    expect(panel().style.display).toBe('')
  })
})
