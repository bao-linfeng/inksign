<script setup lang="ts">
import type { PageRangeKind } from '@/services/batch-placement'
import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/radio-group'
import { computed, ref, watch } from 'vue'

import { PAGE_RANGE_ERROR, pagesFor } from '@/services/batch-placement'

const props = defineProps<{
  pageCount: number
  /** Zero-based pages that already show this signature; they are skipped */
  existingPages: readonly number[]
  /** What is copied: 签名 or 日期 */
  noun?: string
}>()

const emit = defineEmits<{ confirm: [pageIndexes: number[]] }>()
const open = defineModel<boolean>('open', { required: true })

const kind = ref<PageRangeKind>('all')
const custom = ref('')

watch(open, (opened) => {
  if (opened) {
    kind.value = 'all'
    custom.value = ''
  }
})

const options = computed<{ value: PageRangeKind, label: string }[]>(() => [
  { value: 'all', label: `全部页（共 ${props.pageCount} 页）` },
  { value: 'all-but-last', label: '除最后一页' },
  { value: 'last', label: '仅最后一页' },
  { value: 'custom', label: '自定义页码' },
])

const pages = computed(() => pagesFor(kind.value, props.pageCount, custom.value))
/** Only complain once something was typed */
const invalid = computed(() => kind.value === 'custom' && custom.value.trim() !== '' && pages.value === null)
const newPages = computed(() => {
  const existing = new Set(props.existingPages)
  return (pages.value ?? []).filter(page => !existing.has(page))
})
const summary = computed(() => {
  const noun = props.noun ?? '签名'
  const chosen = pages.value?.length ?? 0
  const skipped = chosen - newPages.value.length
  if (newPages.value.length)
    return `将在 ${newPages.value.length} 页添加${noun}${skipped ? `，已有此${noun}的 ${skipped} 页跳过` : ''}。`
  return chosen ? `所选页面都已有此${noun}。` : ''
})

function confirm() {
  if (!newPages.value.length)
    return
  emit('confirm', newPages.value)
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>应用到多页</DialogTitle>
        <DialogDescription>
          在所选页面的相同位置添加这个{{ noun ?? '签名' }}：与最近的页面角保持相同边距和大小，页面尺寸不同也一致。
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="confirm">
        <RadioGroup v-model="kind" aria-label="页码范围" class="gap-1">
          <Label
            v-for="option in options"
            :key="option.value"
            class="cursor-pointer rounded-md px-2 py-2 font-normal hover:bg-muted"
          >
            <RadioGroupItem :value="option.value" />
            {{ option.label }}
          </Label>
        </RadioGroup>

        <div v-if="kind === 'custom'" class="flex flex-col gap-2 pl-8">
          <Input
            v-model="custom"
            placeholder="如 1-3,5"
            aria-label="自定义页码"
            inputmode="text"
            autocomplete="off"
            :aria-invalid="invalid"
            autofocus
          />
          <p v-if="invalid" class="text-xs text-destructive" role="alert">
            {{ PAGE_RANGE_ERROR }}
          </p>
        </div>

        <p class="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {{ summary }}
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">
            取消
          </Button>
          <Button type="submit" :disabled="!newPages.length">
            应用
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
