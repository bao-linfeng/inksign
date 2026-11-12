<script setup lang="ts">
import type { DateField } from '@/services/date-renderer'
import type { PreviewPage } from '@/services/pdf-import'
import { CalendarPlus, CopyPlus, Keyboard, Layers, Pencil, Plus, Trash2, X } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { computed, ref } from 'vue'

import { DATE_PLACED_HEIGHT, renderDateImage } from '@/services/date-renderer'
import { rectBelow } from '@/services/placement'
import { useSigningStore } from '@/stores/signing'

import BatchDialog from './BatchDialog.vue'
import DateDialog from './DateDialog.vue'

const props = defineProps<{
  /** Visible page sizes, to place dates and batch copies in page units */
  pages: readonly PreviewPage[]
}>()

defineEmits<{ create: [] }>()

const signing = useSigningStore()

const countBySource = computed(() => {
  const counts = new Map<string, number>()
  for (const placement of signing.placements)
    counts.set(placement.sourceId, (counts.get(placement.sourceId) ?? 0) + 1)
  return counts
})
const pageCount = computed(() => new Set(signing.placements.map(p => p.pageIndex)).size)

const selectedSource = computed(() => signing.selected && signing.sourceOf(signing.selected.sourceId))
const selectedNoun = computed(() => (selectedSource.value?.kind === 'date' ? '日期' : '签名'))
const groupSize = computed(() => {
  const groupId = signing.selected?.groupId
  return groupId ? signing.placements.filter(p => p.groupId === groupId).length : 0
})

// Dates (PRD FR-09)
const dateOpen = ref(false)
/** Date source being edited; `null` creates a new one */
const editingDateId = ref<string | null>(null)
/** Placement to put the new date under; `null` arms the date for a click instead */
const dateAnchorId = ref<string | null>(null)
const editingDate = computed(() => (editingDateId.value ? signing.sourceOf(editingDateId.value)?.date ?? null : null))

function openDate(editId: string | null, anchorId: string | null) {
  editingDateId.value = editId
  dateAnchorId.value = anchorId
  dateOpen.value = true
}

function placeDateBelow(dateSourceId: string, anchorId: string) {
  const anchor = signing.placements.find(p => p.id === anchorId)
  const source = signing.sourceOf(dateSourceId)
  const page = anchor && props.pages[anchor.pageIndex]
  if (!source || !page)
    return
  signing.placeSource(source.id, anchor.pageIndex, rectBelow(anchor, page, source.naturalWidth / source.naturalHeight, DATE_PLACED_HEIGHT))
}

/** Reuses the latest date, so a contract gets the same date everywhere; asks for one the first time. */
function addDateBelow() {
  const anchor = signing.selected
  if (!anchor)
    return
  const latest = [...signing.sources].reverse().find(s => s.kind === 'date')
  if (latest)
    placeDateBelow(latest.id, anchor.id)
  else
    openDate(null, anchor.id)
}

async function onDateConfirm(field: DateField) {
  const image = await renderDateImage(field)
  if (editingDateId.value) {
    signing.replaceImage(editingDateId.value, image, props.pages, field)
    return
  }
  const source = signing.addSource('date', image, field)
  if (dateAnchorId.value)
    placeDateBelow(source.id, dateAnchorId.value)
  else
    signing.arm(source.id)
}

// Batch signing (PRD FR-10)
const batchOpen = ref(false)
const existingPages = computed(() => {
  const sourceId = signing.selected?.sourceId
  return signing.placements.filter(p => p.sourceId === sourceId).map(p => p.pageIndex)
})

function onBatchConfirm(pageIndexes: number[]) {
  if (signing.selected)
    signing.applyToPages(signing.selected.id, pageIndexes, props.pages)
}
</script>

<template>
  <aside aria-label="签名" class="flex min-h-0 flex-col bg-sidebar">
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border px-4 text-xs">
      <span class="font-medium text-sidebar-foreground">签名</span>
      <span v-if="signing.placements.length" class="text-muted-foreground tabular-nums">
        {{ pageCount }} 页 · {{ signing.placements.length }} 处
      </span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <Button @click="$emit('create')">
          <Plus aria-hidden="true" />
          新建签名
        </Button>
        <Button variant="outline" title="添加签署日期" @click="openDate(null, null)">
          <CalendarPlus aria-hidden="true" />
          日期
        </Button>
      </div>

      <p v-if="!signing.sources.length" class="rounded-lg border border-dashed px-4 py-6 text-center text-sm leading-relaxed text-muted-foreground">
        手写或上传一个签名，<br>然后点击页面放置。
      </p>

      <section v-else class="flex flex-col gap-2">
        <h2 class="text-xs font-medium text-muted-foreground">
          本次使用的签名 · 点击后放置
        </h2>
        <ul class="flex flex-col gap-2">
          <li v-for="source in signing.sources" :key="source.id" class="group relative">
            <button
              type="button"
              class="flex w-full items-center justify-center rounded-lg border bg-white p-2 outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
              :class="[
                source.kind === 'date' ? 'h-12 px-10' : 'h-20',
                signing.armedSourceId === source.id && 'border-primary ring-2 ring-primary/30',
              ]"
              :aria-pressed="signing.armedSourceId === source.id"
              :aria-label="`放置此${source.kind === 'date' ? '日期' : '签名'}${countBySource.get(source.id) ? `（已放置 ${countBySource.get(source.id)} 处）` : ''}`"
              @click="signing.arm(signing.armedSourceId === source.id ? null : source.id)"
            >
              <img :src="source.previewUrl" alt="" class="max-h-full max-w-full object-contain">
            </button>
            <span
              v-if="countBySource.get(source.id)"
              class="pointer-events-none absolute bottom-1.5 left-2 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums"
            >
              {{ countBySource.get(source.id) }} 处
            </span>
            <div class="absolute top-1 right-1 flex opacity-0 group-hover:opacity-100 has-focus-visible:opacity-100">
              <button
                v-if="source.kind === 'date'"
                type="button"
                class="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="修改此日期"
                title="修改此日期"
                @click="openDate(source.id, null)"
              >
                <Pencil class="size-3.5" />
              </button>
              <button
                type="button"
                class="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="`移除此${source.kind === 'date' ? '日期' : '签名'}及其所有放置`"
                :title="`移除此${source.kind === 'date' ? '日期' : '签名'}及其所有放置`"
                @click="signing.removeSource(source.id)"
              >
                <X class="size-3.5" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="signing.selected" class="flex flex-col gap-2 rounded-lg border bg-background p-3">
        <h2 class="text-xs font-medium">
          已选中{{ selectedNoun }} · 第 {{ signing.selected.pageIndex + 1 }} 页
          <span v-if="groupSize > 1" class="font-normal text-muted-foreground">· 批量组 {{ groupSize }} 处</span>
        </h2>
        <p class="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Keyboard class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          拖动移动，拖动四角缩放；方向键微调（Shift 加速），Delete 删除。
        </p>
        <Button variant="outline" size="sm" :disabled="pages.length < 2" @click="batchOpen = true">
          <CopyPlus aria-hidden="true" />
          应用到多页
        </Button>
        <Button v-if="selectedSource?.kind !== 'date'" variant="outline" size="sm" @click="addDateBelow">
          <CalendarPlus aria-hidden="true" />
          在下方添加日期
        </Button>
        <div class="grid gap-2" :class="groupSize > 1 && 'grid-cols-2'">
          <Button variant="outline" size="sm" class="text-destructive hover:text-destructive" @click="signing.remove(signing.selected.id)">
            <Trash2 aria-hidden="true" />
            删除
          </Button>
          <Button
            v-if="groupSize > 1"
            variant="outline"
            size="sm"
            class="text-destructive hover:text-destructive"
            :title="`删除这一组批量添加的 ${groupSize} 处`"
            @click="signing.removeGroup(signing.selected.groupId!)"
          >
            <Layers aria-hidden="true" />
            删除整组
          </Button>
        </div>
      </section>
    </div>

    <DateDialog v-model:open="dateOpen" :initial="editingDate" :confirm-label="dateAnchorId ? '添加到签名下方' : undefined" @confirm="onDateConfirm" />
    <BatchDialog v-model:open="batchOpen" :page-count="pages.length" :existing-pages="existingPages" :noun="selectedNoun" @confirm="onBatchConfirm" />
  </aside>
</template>
