import type { PageGeometry } from '../coordinate-transform'
import type { SaveMode } from '../pdf-exporter'
import type { Placement, PlacementRect } from '@/types/signature'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { pdfFixtures } from '../../../tests/fixtures/pdf-fixtures'
import { countImageObjects, inspectPages } from '../../../tests/helpers/drawn-images'
import { arrowSignaturePng } from '../../../tests/helpers/png'
import { visibleSize } from '../coordinate-transform'
import { exportSignedPdf } from '../pdf-exporter'

const signature = arrowSignaturePng()
const images = new Map([['sig', signature]])

/** Bottom-right area of the visible page, keeping the 2:1 aspect ratio of the test signature. */
function bottomRight(geometry: PageGeometry): PlacementRect {
  const { width, height } = visibleSize(geometry)
  const widthRatio = 0.3
  const heightRatio = (widthRatio * width) / 2 / height
  return { xRatio: 0.6, yRatio: 0.92 - heightRatio, widthRatio, heightRatio }
}

async function signEveryPage(original: Uint8Array, saveMode: SaveMode = 'auto') {
  const pages = (await inspectPages(original)).map(page => page.geometry)
  const placements: Placement[] = pages.map((geometry, pageIndex) => ({
    id: `p${pageIndex}`,
    sourceId: 'sig',
    pageIndex,
    ...bottomRight(geometry),
  }))
  const { bytes: signed } = await exportSignedPdf({ originalBytes: original, pages, images, placements, saveMode })
  return { pages, placements, signed }
}

describe('exportSignedPdf', () => {
  // PRD §10 cases 1-5: the image must land exactly on the placed rectangle and read upright
  describe.each(pdfFixtures)('$name: $description', (fixture) => {
    it.each(['rewrite', 'incremental'] as const)('draws the signature upright at the placed rectangle (%s)', async (mode) => {
      const original = await fixture.build()
      const { placements, signed } = await signEveryPage(original, mode)
      if (mode === 'incremental')
        expect(signed.subarray(0, original.length)).toEqual(original)
      const exported = await inspectPages(signed)

      exported.forEach((page, pageIndex) => {
        const { xRatio, yRatio, widthRatio, heightRatio } = placements[pageIndex]!
        const right = xRatio + widthRatio
        const bottom = yRatio + heightRatio

        expect(page.images).toHaveLength(1)
        const [image] = page.images
        const expected = {
          topLeft: [xRatio, yRatio],
          topRight: [right, yRatio],
          bottomLeft: [xRatio, bottom],
          bottomRight: [right, bottom],
        }
        for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
          expect(image![corner][0], `${corner} x`).toBeCloseTo(expected[corner][0]!, 6)
          expect(image![corner][1], `${corner} y`).toBeCloseTo(expected[corner][1]!, 6)
        }
      })
    })
  })

  it('is not affected by a transform the original content leaves behind', async () => {
    const original = await pdfFixtures.find(f => f.name === 'dirty-ctm')!.build()
    // Guards the fixture itself: without the leak the upright test above would prove nothing
    expect((await inspectPages(original))[0]!.unscopedTransforms).toBeGreaterThan(0)

    const { signed } = await signEveryPage(original)
    // pdf-lib wraps the existing content in q … Q before appending (autoNormalizeCTM)
    expect((await inspectPages(signed))[0]!.unscopedTransforms).toBe(0)
  })

  it('rewrites a PDF without digital signatures by default', async () => {
    const original = await pdfFixtures.find(f => f.name === 'broken-xref')!.build()
    const pages = (await inspectPages(original)).map(page => page.geometry)
    const result = await exportSignedPdf({ originalBytes: original, pages, images, placements: [] })

    expect(result.incremental).toBe(false)
    // A rewrite also repairs the damaged structure: the new xref points at real objects
    const text = new TextDecoder('latin1').decode(result.bytes)
    const startxref = Number(/startxref\s+(\d+)/.exec(text.slice(text.lastIndexOf('startxref')))![1])
    // A classic xref table or an xref stream object
    expect(text.slice(startxref, startxref + 20)).toMatch(/^(?:xref|\d+ \d+ obj)/)
  })

  it('embeds a signature once however often it is placed (PRD §10 case 16)', async () => {
    const original = await pdfFixtures.find(f => f.name === 'a4-portrait')!.build()
    const pages = (await inspectPages(original)).map(page => page.geometry)
    const rect = bottomRight(pages[0]!)
    const placements = (count: number): Placement[] =>
      Array.from({ length: count }, (_, i) => ({ id: `p${i}`, sourceId: 'sig', pageIndex: 0, ...rect, yRatio: 0.05 + i * 0.08 }))

    const { bytes: once } = await exportSignedPdf({ originalBytes: original, pages, images, placements: placements(1) })
    const { bytes: tenTimes } = await exportSignedPdf({ originalBytes: original, pages, images, placements: placements(10) })

    expect(await countImageObjects(tenTimes)).toBe(await countImageObjects(once))
    expect((await inspectPages(tenTimes))[0]!.images).toHaveLength(10)
  })

  it('starts every export from the original bytes (PRD §10 case 12)', async () => {
    const original = await pdfFixtures.find(f => f.name === 'a4-portrait')!.build()
    const before = original.slice()
    const pages = (await inspectPages(original)).map(page => page.geometry)
    const placement: Placement = { id: 'p0', sourceId: 'sig', pageIndex: 0, ...bottomRight(pages[0]!) }

    await exportSignedPdf({ originalBytes: original, pages, images, placements: [placement] })
    const { bytes: second } = await exportSignedPdf({ originalBytes: original, pages, images, placements: [{ ...placement, xRatio: 0.1 }] })

    expect(original).toEqual(before)
    const [image] = (await inspectPages(second))[0]!.images
    expect((await inspectPages(second))[0]!.images).toHaveLength(1)
    expect(image!.topLeft[0]).toBeCloseTo(0.1, 6)
  })

  it('rejects inconsistent input instead of writing a wrong file', async () => {
    const original = await pdfFixtures.find(f => f.name === 'a4-portrait')!.build()
    const pages = (await inspectPages(original)).map(page => page.geometry)
    const rect = bottomRight(pages[0]!)

    await expect(exportSignedPdf({ originalBytes: original, pages: [], images, placements: [] }))
      .rejects
      .toThrow('Page count mismatch')
    await expect(exportSignedPdf({ originalBytes: original, pages, images, placements: [{ id: 'p', sourceId: 'sig', pageIndex: 3, ...rect }] }))
      .rejects
      .toThrow('does not exist')
    await expect(exportSignedPdf({ originalBytes: original, pages, images, placements: [{ id: 'p', sourceId: 'nope', pageIndex: 0, ...rect }] }))
      .rejects
      .toThrow('Missing image')
  })
})

// `pnpm samples:pdf` writes every fixture and its signed export, to check them in Chrome, Edge and
// Acrobat Reader (PRD §10 case 11): the arrow must point up inside the bottom-right corner.
describe.runIf(process.env.WRITE_SAMPLES)('sample PDFs', () => {
  it('writes fixtures and signed exports', async () => {
    const outDir = fileURLToPath(new URL('../../../tests/fixtures/out/', import.meta.url))
    mkdirSync(outDir, { recursive: true })
    for (const fixture of pdfFixtures) {
      const original = await fixture.build()
      const { signed } = await signEveryPage(original)
      writeFileSync(join(outDir, `${fixture.name}.pdf`), original)
      writeFileSync(join(outDir, `${fixture.name}_signed.pdf`), signed)
    }
  })
})
