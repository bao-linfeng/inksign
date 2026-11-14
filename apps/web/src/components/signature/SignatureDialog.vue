<script setup lang="ts">
import type { SignatureImage } from '@/services/signature-image'
import type { SignatureSource } from '@/types/signature'
import { CircleAlert, Download } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import { Checkbox } from '@repo/ui/components/checkbox'
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
import PinHint from '@/components/library/PinHint.vue'
import { downloadBytes, signaturePngName } from '@/services/download'
import { isValidPin } from '@/services/signature-crypto'
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
const uploaded = ref<SignatureImage | null>(null)
const busy = ref(false)
const drawPad = useTemplateRef('drawPad')
const save = ref(false)
const name = ref('全名')
const protect = ref(false)
const pin = ref('')
const repeatPin = ref('')
const error = ref<string | null>(null)
const consentOpen = ref(false)
const consentGiven = ref(false)
const draftRevision = ref(0)

const hasImage = computed(() => tab.value === 'draw' ? !drawEmpty.value : tab.value === 'image' && uploaded.value !== null)
const ready = computed(() => hasImage.value && (!props.saveOnly || save.value) && (!save.value || (library.available && !library.full && name.value.trim() && (!protect.value || (isValidPin(pin.value) && pin.value === repeatPin.value)))))

// Every opening starts from a blank pad
watch(open, async (value) => {
  pin.value = ''
  repeatPin.value = ''
  uploaded.value = null
  if (value) {
    drawEmpty.value = true
    save.value = false
    name.value = '全名'
    protect.value = false
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
    const entry = save.value ? await library.save(name.value, image, protect.value ? pin.value : null) : null
    if (props.saveOnly) {
      draftRevision.value++
      uploaded.value = null
      drawEmpty.value = true
      tab.value = 'library'
      save.value = false
      protect.value = false
      pin.value = ''
      repeatPin.value = ''
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
</script>

<template>
  <Dialog :open="open" @update:open="!busy && (open = $event)">
    <DialogContent class="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-w-xl" :show-close-button="!busy">
      <DialogHeader>
        <DialogTitle>{{ saveOnly ? '我的签名' : '添加签名' }}</DialogTitle>
        <DialogDescription>{{ saveOnly ? '管理本设备签名，或手写、上传一个新签名。' : '选择已有签名，或手写、上传一个新签名，确认后点击页面放置。' }} 签名只在本机浏览器中处理。</DialogDescription>
      </DialogHeader>

      <Tabs v-model="tab" class="gap-3">
        <TabsList class="grid w-full grid-cols-3">
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
        <TabsContent value="draw" force-mount class="data-[state=inactive]:hidden">
          <SignatureDrawPad :key="draftRevision" ref="drawPad" @change="drawEmpty = $event" />
        </TabsContent>
        <TabsContent value="image" force-mount class="data-[state=inactive]:hidden">
          <SignatureUpload :key="draftRevision" @change="uploaded = $event" />
        </TabsContent>
      </Tabs>

      <fieldset v-if="tab !== 'library'" class="flex flex-col gap-3 rounded-lg border p-3" :disabled="busy">
        <label class="flex items-center gap-2 text-sm font-medium">
          <Checkbox v-model="save" :disabled="!library.available || library.full" />
          保存到本设备
        </label>
        <p v-if="!library.available || library.full" class="text-xs text-muted-foreground">
          {{ library.full ? '最多保存 20 个签名，请先删除不用的签名。' : '当前浏览器无法保存签名，可下载 PNG 备份。' }}
        </p>
        <p v-else class="text-xs text-muted-foreground">
          仅主动保存的签名会保留，清理浏览器数据会丢失，请勿在公共电脑上保存。
        </p>
        <template v-if="save">
          <div class="flex flex-col gap-2">
            <Label for="signature-name">签名名称</Label>
            <Input id="signature-name" v-model="name" :maxlength="SIGNATURE_NAME_MAX_LENGTH" placeholder="例如：全名、简签" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <Checkbox v-model="protect" :disabled="!library.canEncrypt" />
            使用 PIN 保护
          </label>
          <p v-if="!library.canEncrypt" class="text-xs text-muted-foreground">
            当前环境不支持 PIN 加密，请使用 HTTPS 或本机 localhost。
          </p>
          <template v-if="protect">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-2">
                <Label for="save-pin">PIN（6–32 位数字或字母）</Label><Input id="save-pin" v-model="pin" type="password" autocomplete="off" :aria-invalid="pin !== '' && !isValidPin(pin)" />
              </div>
              <div class="flex flex-col gap-2">
                <Label for="save-pin-repeat">再次输入 PIN</Label><Input id="save-pin-repeat" v-model="repeatPin" type="password" autocomplete="off" :aria-invalid="repeatPin !== '' && repeatPin !== pin" />
              </div>
            </div>
            <p v-if="repeatPin && repeatPin !== pin" class="text-xs text-destructive">
              两次输入的 PIN 不一致。
            </p>
            <PinHint />
          </template>
        </template>
      </fieldset>
      <Alert v-if="error" variant="destructive">
        <CircleAlert aria-hidden="true" /><AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <DialogFooter class="max-sm:flex-col-reverse max-sm:gap-2">
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
