<script setup lang="ts">
import type { SignatureImage } from '@/services/signature-image'
import { CircleAlert, ImageUp } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import { Spinner } from '@repo/ui/components/spinner'
import { onBeforeUnmount, ref, useTemplateRef } from 'vue'

import { IMAGE_ERROR_MESSAGE, normalizeImage } from '@/services/image-normalizer'

const emit = defineEmits<{ change: [image: SignatureImage | null] }>()

const input = useTemplateRef('input')
const busy = ref(false)
const error = ref<string | null>(null)
const previewUrl = ref<string | null>(null)

function setPreview(image: SignatureImage | null) {
  if (previewUrl.value)
    URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = image ? URL.createObjectURL(new Blob([image.pngBytes as BlobPart], { type: 'image/png' })) : null
}

async function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file)
    return
  busy.value = true
  error.value = null
  try {
    const image = await normalizeImage(file)
    setPreview(image)
    emit('change', image)
  }
  catch {
    setPreview(null)
    error.value = IMAGE_ERROR_MESSAGE
    emit('change', null)
  }
  finally {
    busy.value = false
  }
}

onBeforeUnmount(() => setPreview(null))
</script>

<template>
  <div class="flex flex-col gap-3">
    <button
      type="button"
      class="checkerboard relative grid h-52 place-items-center overflow-hidden rounded-lg border border-dashed outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="previewUrl ? '更换签名图片' : '选择签名图片'"
      :disabled="busy"
      @click="input?.click()"
    >
      <img v-if="previewUrl" :src="previewUrl" alt="签名图片预览（已裁去透明边缘）" class="max-h-44 max-w-[90%] object-contain">
      <span v-else class="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Spinner v-if="busy" class="size-6" aria-label="正在处理" />
        <ImageUp v-else class="size-7" aria-hidden="true" />
        选择 PNG、JPG 或 WebP 图片
        <span class="text-xs">透明背景的 PNG 效果最好</span>
      </span>
    </button>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" tabindex="-1" aria-hidden="true" @change="onChange">

    <Alert v-if="error" variant="destructive" class="py-2">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <div v-else-if="previewUrl" class="flex items-center justify-between text-xs text-muted-foreground">
      <span>图片背景按原样保留，不会自动去底。</span>
      <Button variant="ghost" size="sm" :disabled="busy" @click="input?.click()">
        更换图片
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* Shows which parts of the image are transparent */
.checkerboard {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, oklch(0.95 0 0) 25%, transparent 25%),
    linear-gradient(-45deg, oklch(0.95 0 0) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, oklch(0.95 0 0) 75%),
    linear-gradient(-45deg, transparent 75%, oklch(0.95 0 0) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}
</style>
