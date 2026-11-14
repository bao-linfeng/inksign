<script setup lang="ts">
import type { SignatureImage } from '@/services/signature-image'
import type { SignatureSource } from '@/types/signature'
import { CircleAlert, Download } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
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
import { Spinner } from '@repo/ui/components/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs'
import { computed, ref, useTemplateRef, watch } from 'vue'

import LibraryList from '@/components/library/LibraryList.vue'
import PinDialog from '@/components/library/PinDialog.vue'
import { downloadBytes, signaturePngName } from '@/services/download'
import { SIGNATURE_NAME_MAX_LENGTH, vaultErrorMessage } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'

import SignatureDrawPad from './SignatureDrawPad.vue'
import SignatureUpload from './SignatureUpload.vue'

const props = defineProps<{ saveOnly?: boolean }>()
const emit = defineEmits<{ create: [kind: SignatureSource['kind'], image: SignatureImage, libraryId?: string] }>()
const open = defineModel<boolean>('open', { required: true })
const library = useLibraryStore()
const tab = ref<'library' | 'draw' | 'image'>('draw')
const drawEmpty = ref(true)
const expanded = ref(false)
const uploaded = ref<SignatureImage | null>(null)
const busy = ref(false)
const drawPad = useTemplateRef('drawPad')
const save = computed(() => props.saveOnly || library.settings.autoSave)
const name = ref('全名')
const error = ref<string | null>(null)
const consentOpen = ref(false)
const consentGiven = ref(false)
const draftRevision = ref(0)
const unlockOpen = ref(false)

const hasImage = computed(() => tab.value === 'draw' ? !drawEmpty.value : tab.value === 'image' && uploaded.value !== null)
const ready = computed(() => hasImage.value && (!save.value || (library.available && !library.full && name.value.trim())))

// Every opening starts from a blank pad
watch(open, async (value) => {
  expanded.value = false
  unlockOpen.value = false
  uploaded.value = null
  if (value) {
    drawEmpty.value = true
    name.value = '全名'
    error.value = null
    consentOpen.value = false
    tab.value = props.saveOnly || library.entries.length ? 'library' : 'draw'
    await library.load()
    if (open.value && library.entries.length)
      tab.value = 'library'
  }
}, { immediate: true })

function selectSaved(id: string) {
  const entry = library.entries.find(e => e.id === id)
  const pngBytes = library.bytesOf(id)
  if (!entry || !pngBytes)
    return
  emit('create', 'image', { pngBytes, width: entry.naturalWidth, height: entry.naturalHeight }, id)
  open.value = false
}

async function confirm(backup = false) {
  if (busy.value || !hasImage.value || (!backup && !ready.value))
    return
  if (!backup && save.value && library.locked) {
    unlockOpen.value = true
    return
  }
  if (!backup && save.value && !consentGiven.value && library.entries.length === 0) {
    consentOpen.value = true
    return
  }
  busy.value = true
  error.value = null
  try {
    const image = tab.value === 'draw' ? await drawPad.value?.toImage() : uploaded.value
    if (!image)
      return
    if (backup) {
      downloadBytes(image.pngBytes, signaturePngName(name.value), 'image/png')
      return
    }
    const entry = save.value ? await library.save(name.value, image) : null
    if (props.saveOnly) {
      draftRevision.value++
      uploaded.value = null
      drawEmpty.value = true
      tab.value = 'library'
      return
    }
    emit('create', tab.value === 'draw' ? 'draw' : 'image', image, entry?.id)
    open.value = false
  }
  catch (caught) {
    error.value = save.value ? vaultErrorMessage(caught) : '签名处理失败，请重试。'
  }
  finally {
    busy.value = false
  }
}

function acceptAndSave() {
  consentGiven.value = true
  consentOpen.value = false
  void confirm()
}

function handleEscape(event: KeyboardEvent) {
  if (expanded.value) {
    event.preventDefault()
    expanded.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="!busy && (open = $event)">
    <DialogContent
      class="signature-dialog max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-w-xl"
      :class="expanded && 'signature-dialog-expanded translate-x-0 translate-y-0'"
      :show-close-button="!busy && !expanded"
      @escape-key-down="handleEscape"
    >
      <DialogHeader :class="expanded && 'sr-only'">
        <DialogTitle>{{ saveOnly ? '我的签名' : '添加签名' }}</DialogTitle>
        <DialogDescription>{{ saveOnly ? '管理本设备签名，或手写、上传一个新签名。' : '选择已有签名，或手写、上传一个新签名，确认后点击页面放置。' }} 签名只在本机浏览器中处理。</DialogDescription>
      </DialogHeader>

      <Tabs v-model="tab" class="gap-3" :class="expanded && 'min-h-0 flex-1'">
        <TabsList v-show="!expanded" class="grid w-full grid-cols-3">
          <TabsTrigger value="library" :disabled="busy">
            我的签名（{{ library.entries.length }}）
          </TabsTrigger>
          <TabsTrigger value="draw" :disabled="busy">
            手写
          </TabsTrigger>
          <TabsTrigger value="image" :disabled="busy">
            上传图片
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <LibraryList :selectable="!saveOnly" @select="selectSaved" @create="tab = 'draw'" />
        </TabsContent>
        <TabsContent value="draw" force-mount class="data-[state=inactive]:hidden" :class="expanded && 'flex min-h-0 flex-col'">
          <SignatureDrawPad :key="draftRevision" ref="drawPad" v-model:expanded="expanded" @change="drawEmpty = $event" />
        </TabsContent>
        <TabsContent value="image" force-mount class="data-[state=inactive]:hidden">
          <SignatureUpload :key="draftRevision" @change="uploaded = $event" />
        </TabsContent>
      </Tabs>

      <div v-if="tab !== 'library' && save" v-show="!expanded" class="flex flex-col gap-2">
        <Label for="signature-name">签名名称</Label>
        <Input id="signature-name" v-model="name" :disabled="busy" :maxlength="SIGNATURE_NAME_MAX_LENGTH" placeholder="例如：全名、简签" />
        <p v-if="!library.available || library.full" class="text-xs text-destructive">
          {{ library.full ? '最多保存 20 个签名，请先删除不用的签名。' : '当前浏览器无法保存签名，可下载 PNG 备份。' }}
        </p>
      </div>
      <Alert v-if="error" variant="destructive">
        <CircleAlert aria-hidden="true" /><AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <DialogFooter v-show="!expanded" class="max-sm:flex-col-reverse max-sm:gap-2">
        <Button class="max-sm:w-full" variant="outline" :disabled="busy" @click="open = false">
          取消
        </Button>
        <Button v-if="tab !== 'library'" class="max-sm:w-full" variant="outline" :disabled="!hasImage || busy" @click="confirm(true)">
          <Download aria-hidden="true" /> 下载 PNG
        </Button>
        <Button v-if="tab !== 'library'" class="max-sm:w-full" :disabled="!ready || busy" @click="confirm()">
          <Spinner v-if="busy" aria-label="正在处理" />
          {{ saveOnly ? '保存签名' : save ? '保存并使用' : '使用此签名' }}
        </Button>
      </DialogFooter>

      <PinDialog v-model:open="unlockOpen" @done="confirm()" />

      <Dialog v-model:open="consentOpen">
        <DialogContent class="max-h-[90svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>将签名保存到本设备？</DialogTitle>
            <DialogDescription>签名仅保存在本浏览器中，不会上传。清理浏览器数据、无痕模式结束或浏览器自动清理都可能导致丢失，建议下载 PNG 备份。请勿在公共或共用电脑上保存。</DialogDescription>
          </DialogHeader>
          <p class="text-sm leading-relaxed text-muted-foreground">
            图片形式的签名不具备证书数字签名的防篡改与身份认证能力。用于重要合同时，请与对方确认是否接受，必要时使用具备 CA 认证的电子签约平台。
          </p>
          <DialogFooter>
            <Button variant="outline" @click="consentOpen = false">
              返回
            </Button>
            <Button @click="acceptAndSave">
              了解并保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogContent>
  </Dialog>
</template>

<style>
.signature-dialog {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.signature-dialog input,
.signature-dialog textarea {
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;
}

.signature-dialog-expanded {
  top: 0;
  left: 0;
  display: flex;
  width: 100%;
  max-width: none;
  height: 100dvh;
  max-height: none;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
    max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
  animation: none;
}

@media (max-width: 639px) {
  .signature-dialog:not(.signature-dialog-expanded) {
    max-width: calc(100% - 1rem);
    gap: 0.75rem;
    padding: 1rem;
  }
}
</style>
