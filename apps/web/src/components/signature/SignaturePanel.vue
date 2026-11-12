<script setup lang="ts">
import { Keyboard, Plus, Trash2, X } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { computed } from 'vue'

import { useSigningStore } from '@/stores/signing'

defineEmits<{ create: [] }>()

const signing = useSigningStore()

const countBySource = computed(() => {
  const counts = new Map<string, number>()
  for (const placement of signing.placements)
    counts.set(placement.sourceId, (counts.get(placement.sourceId) ?? 0) + 1)
  return counts
})
const pageCount = computed(() => new Set(signing.placements.map(p => p.pageIndex)).size)
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
      <Button class="w-full" @click="$emit('create')">
        <Plus aria-hidden="true" />
        新建签名
      </Button>

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
              class="flex h-20 w-full items-center justify-center rounded-lg border bg-white p-2 outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
              :class="signing.armedSourceId === source.id && 'border-primary ring-2 ring-primary/30'"
              :aria-pressed="signing.armedSourceId === source.id"
              :aria-label="`放置此签名${countBySource.get(source.id) ? `（已放置 ${countBySource.get(source.id)} 处）` : ''}`"
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
            <button
              type="button"
              class="absolute top-1 right-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="移除此签名及其所有放置"
              title="移除此签名及其所有放置"
              @click="signing.removeSource(source.id)"
            >
              <X class="size-3.5" />
            </button>
          </li>
        </ul>
      </section>

      <section v-if="signing.selected" class="flex flex-col gap-2 rounded-lg border bg-background p-3">
        <h2 class="text-xs font-medium">
          已选中 · 第 {{ signing.selected.pageIndex + 1 }} 页
        </h2>
        <p class="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Keyboard class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          拖动移动，拖动四角缩放；方向键微调（Shift 加速），Delete 删除。
        </p>
        <Button variant="outline" size="sm" class="text-destructive hover:text-destructive" @click="signing.remove(signing.selected.id)">
          <Trash2 aria-hidden="true" />
          删除
        </Button>
      </section>
    </div>
  </aside>
</template>
