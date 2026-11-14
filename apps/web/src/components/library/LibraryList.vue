<script setup lang="ts">
import type { StoredSignature } from '@/types/signature'
import { CircleAlert, Download, LockKeyhole, Plus, UnlockKeyhole } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Spinner } from '@repo/ui/components/spinner'
import { ref, watch } from 'vue'

import { downloadBytes, signaturePngName } from '@/services/download'
import { SIGNATURE_NAME_MAX_LENGTH, vaultErrorMessage } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'

import PinDialog from './PinDialog.vue'

defineProps<{ selectable?: boolean }>()
const emit = defineEmits<{ select: [id: string], create: [] }>()
const library = useLibraryStore()
const error = ref<string | null>(null)
const busy = ref(false)
const target = ref<StoredSignature | null>(null)
const pinOpen = ref(false)
const afterUnlock = ref<'select' | 'download' | null>(null)
const action = ref<'rename' | 'delete' | null>(null)
const name = ref('')

watch(pinOpen, (open) => {
  if (!open) {
    target.value = null
    afterUnlock.value = null
  }
})

function askPin(entry: StoredSignature) {
  target.value = entry
  afterUnlock.value = null
  pinOpen.value = true
}

function useEntry(entry: StoredSignature, next: 'select' | 'download') {
  error.value = null
  if (library.isLocked(entry)) {
    askPin(entry)
    afterUnlock.value = next
    return
  }
  finishUse(entry.id, next)
}

function finishUse(id: string, next: 'select' | 'download') {
  const entry = library.entries.find(e => e.id === id)
  const bytes = library.bytesOf(id)
  if (!entry || !bytes)
    return
  if (next === 'select')
    emit('select', id)
  else
    downloadBytes(bytes, signaturePngName(entry.name), 'image/png')
}

function onUnlocked(id: string) {
  if (afterUnlock.value)
    finishUse(id, afterUnlock.value)
  afterUnlock.value = null
}

function ask(next: typeof action.value, entry: StoredSignature | null = null) {
  target.value = entry
  name.value = entry?.name ?? ''
  error.value = null
  action.value = next
}

async function confirm() {
  if (busy.value)
    return
  busy.value = true
  error.value = null
  try {
    if (action.value === 'rename' && target.value)
      await library.rename(target.value.id, name.value)
    else if (action.value === 'delete' && target.value)
      await library.remove(target.value.id)
    action.value = null
    target.value = null
  }
  catch (caught) {
    error.value = vaultErrorMessage(caught)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="library.status === 'loading' || library.status === 'idle'" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
      <Spinner /> 正在读取本设备签名…
    </p>
    <Alert v-else-if="!library.available">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>当前浏览器无法保存签名。仍可手写或上传签名，并下载 PNG 备份。</AlertDescription>
    </Alert>
    <div v-else-if="!library.entries.length" class="rounded-lg border border-dashed px-4 py-8 text-center">
      <p class="text-sm font-medium">
        还没有保存的签名
      </p>
      <p class="mt-1 text-xs text-muted-foreground">
        新建并保存一个签名，下次可以直接使用。
      </p>
      <Button variant="outline" size="sm" class="mt-4" @click="emit('create')">
        <Plus aria-hidden="true" /> 新建签名
      </Button>
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground">{{ library.entries.length }} / 20 个签名</span>
      </div>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li v-for="entry in library.entries" :key="entry.id" class="min-w-0 overflow-hidden rounded-lg border">
          <button
            type="button"
            class="flex h-24 w-full items-center justify-center bg-white p-3 text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :aria-label="`${library.isLocked(entry) ? '解锁' : selectable ? '使用' : '下载'}签名：${entry.name}`"
            @click="useEntry(entry, selectable ? 'select' : 'download')"
          >
            <span v-if="library.isLocked(entry)" class="flex items-center gap-2 text-xs"><LockKeyhole class="size-5" aria-hidden="true" /> 输入 PIN {{ selectable ? '使用' : '下载' }}</span>
            <img v-else :src="library.previews.get(entry.id)" :alt="entry.name" class="max-h-full max-w-full object-contain">
          </button>
          <div class="flex flex-col gap-2 border-t p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium" :title="entry.name">
                  {{ entry.name }}
                </p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ new Date(entry.createdAt).toLocaleDateString() }}
                </p>
              </div>
              <span class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <LockKeyhole v-if="library.isLocked(entry)" class="size-3" aria-hidden="true" />
                <UnlockKeyhole v-else-if="entry.encrypted" class="size-3" aria-hidden="true" />
                {{ entry.encrypted ? library.isLocked(entry) ? '已加密' : '已解锁' : '无 PIN' }}
              </span>
            </div>
            <Button variant="outline" size="sm" @click="useEntry(entry, 'download')">
              <Download aria-hidden="true" /> 下载 PNG 备份
            </Button>
            <div class="flex flex-wrap gap-x-3 gap-y-2 text-xs">
              <Button variant="link" size="sm" class="h-auto p-0 text-xs" @click="ask('rename', entry)">
                重命名
              </Button>
              <Button variant="link" size="sm" class="h-auto p-0 text-xs text-destructive" @click="ask('delete', entry)">
                删除
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <PinDialog v-model:open="pinOpen" :entry="target" @done="onUnlocked" />
    <Dialog :open="action !== null" @update:open="!busy && !$event && (action = null)">
      <DialogContent class="max-h-[90svh] overflow-y-auto sm:max-w-sm" :show-close-button="!busy">
        <DialogHeader>
          <DialogTitle>{{ action === 'rename' ? '重命名签名' : '删除此签名？' }}</DialogTitle>
          <DialogDescription>
            <template v-if="action === 'rename'">
              为“{{ target?.name }}”设置一个便于识别的名称。
            </template>
            <template v-else>
              将删除“{{ target?.name }}”，并移除它在当前 PDF 中的全部放置。此操作无法撤销，请先导出 PDF 或下载 PNG 备份。
            </template>
          </DialogDescription>
        </DialogHeader>
        <form class="flex flex-col gap-4" @submit.prevent="confirm">
          <div v-if="action === 'rename'" class="flex flex-col gap-2">
            <Label for="signature-rename">签名名称</Label>
            <Input id="signature-rename" v-model="name" :maxlength="SIGNATURE_NAME_MAX_LENGTH" :disabled="busy" autofocus />
          </div>
          <Alert v-if="error" variant="destructive">
            <CircleAlert aria-hidden="true" /><AlertDescription>{{ error }}</AlertDescription>
          </Alert>
          <DialogFooter>
            <Button type="button" variant="outline" :disabled="busy" @click="action = null">
              取消
            </Button>
            <Button type="submit" :variant="action === 'rename' ? 'default' : 'destructive'" :disabled="busy || (action === 'rename' && !name.trim())">
              <Spinner v-if="busy" aria-label="正在处理" />
              {{ action === 'rename' ? '保存名称' : '确认删除' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
