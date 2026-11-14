<script setup lang="ts">
import type { PinAction } from './PinDialog.vue'
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
const pinAction = ref<PinAction>('unlock')
const afterUnlock = ref<'select' | 'download' | null>(null)
const action = ref<'rename' | 'delete' | 'clear' | 'lock' | null>(null)
const name = ref('')

watch(pinOpen, (open) => {
  if (!open) {
    target.value = null
    afterUnlock.value = null
  }
})

function askPin(entry: StoredSignature, next: PinAction) {
  target.value = entry
  pinAction.value = next
  afterUnlock.value = null
  pinOpen.value = true
}

function useEntry(entry: StoredSignature, next: 'select' | 'download') {
  error.value = null
  if (library.isLocked(entry)) {
    askPin(entry, 'unlock')
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
    else if (action.value === 'clear')
      await library.clear()
    else if (action.value === 'lock')
      library.lock()
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
    <div class="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
      <p>签名保存在本浏览器，清理浏览器数据会丢失，建议下载 PNG 备份。请勿在公共或共用电脑上保存。</p>
      <p v-if="library.status === 'ready'" class="mt-1 font-medium">
        {{ library.persisted ? '已获持久化存储授权；主动清除站点数据仍会删除签名。' : '浏览器可能自动清理已保存的签名，建议下载备份。' }}
      </p>
    </div>

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
        手写或上传后，勾选“保存到本设备”即可在这里找到。
      </p>
      <Button variant="outline" size="sm" class="mt-4" @click="emit('create')">
        <Plus aria-hidden="true" /> 新建签名
      </Button>
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground">{{ library.entries.length }} / 20 个签名</span>
        <div class="flex gap-1">
          <Button v-if="library.hasUnlocked" variant="outline" size="sm" @click="ask('lock')">
            <LockKeyhole aria-hidden="true" /> 锁定
          </Button>
          <Button variant="ghost" size="sm" class="text-destructive" @click="ask('clear')">
            清空全部
          </Button>
        </div>
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
              <Button v-if="library.canEncrypt" variant="link" size="sm" class="h-auto p-0 text-xs" @click="askPin(entry, entry.encrypted ? 'change' : 'set')">
                {{ entry.encrypted ? '修改 PIN' : '设置 PIN' }}
              </Button>
              <Button v-if="entry.encrypted && library.canEncrypt" variant="link" size="sm" class="h-auto p-0 text-xs" @click="askPin(entry, 'remove')">
                移除 PIN
              </Button>
              <Button variant="link" size="sm" class="h-auto p-0 text-xs text-destructive" @click="ask('delete', entry)">
                删除
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <PinDialog v-model:open="pinOpen" :entry="target" :action="pinAction" @done="onUnlocked" />
    <Dialog :open="action !== null" @update:open="!busy && !$event && (action = null)">
      <DialogContent class="max-h-[90svh] overflow-y-auto sm:max-w-sm" :show-close-button="!busy">
        <DialogHeader>
          <DialogTitle>{{ action === 'rename' ? '重命名签名' : action === 'delete' ? '删除此签名？' : action === 'clear' ? '清空全部签名？' : '锁定受保护的签名？' }}</DialogTitle>
          <DialogDescription>
            <template v-if="action === 'rename'">
              为“{{ target?.name }}”设置一个便于识别的名称。
            </template>
            <template v-else-if="action === 'lock'">
              锁定会清除已解锁的签名，并移除它们在当前 PDF 中的全部放置。请先导出需要保留的内容，再锁定。
            </template>
            <template v-else>
              将{{ action === 'clear' ? '删除本浏览器中保存的全部签名' : `删除“${target?.name}”` }}，并移除它们在当前 PDF 中的全部放置。此操作无法撤销，请先导出 PDF 或下载 PNG 备份。
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
              {{ action === 'rename' ? '保存名称' : action === 'lock' ? '锁定并移除放置' : '确认删除' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
