<script setup lang="ts">
import type { SignatureImage } from '@/services/signature-image'
import type { SignatureSource } from '@/types/signature'
import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs'
import { computed, ref, useTemplateRef, watch } from 'vue'

import SignatureDrawPad from './SignatureDrawPad.vue'
import SignatureUpload from './SignatureUpload.vue'

const emit = defineEmits<{ create: [kind: SignatureSource['kind'], image: SignatureImage] }>()
const open = defineModel<boolean>('open', { required: true })
const tab = ref<'draw' | 'image'>('draw')
const drawEmpty = ref(true)
const uploaded = ref<SignatureImage | null>(null)
const busy = ref(false)
const drawPad = useTemplateRef('drawPad')

const ready = computed(() => (tab.value === 'draw' ? !drawEmpty.value : uploaded.value !== null))

// Every opening starts from a blank pad
watch(open, (value) => {
  if (value) {
    drawEmpty.value = true
    uploaded.value = null
  }
})

async function confirm() {
  busy.value = true
  try {
    const image = tab.value === 'draw' ? await drawPad.value?.toImage() : uploaded.value
    if (!image)
      return
    emit('create', tab.value, image)
    open.value = false
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>新建签名</DialogTitle>
        <DialogDescription>签名只在本机浏览器中处理，确认后点击页面即可放置。</DialogDescription>
      </DialogHeader>

      <Tabs v-model="tab" class="gap-3">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="draw">
            手写
          </TabsTrigger>
          <TabsTrigger value="image">
            上传图片
          </TabsTrigger>
        </TabsList>
        <TabsContent value="draw" force-mount class="data-[state=inactive]:hidden">
          <SignatureDrawPad ref="drawPad" @change="drawEmpty = $event" />
        </TabsContent>
        <TabsContent value="image" force-mount class="data-[state=inactive]:hidden">
          <SignatureUpload @change="uploaded = $event" />
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button variant="outline" @click="open = false">
          取消
        </Button>
        <Button :disabled="!ready || busy" @click="confirm">
          使用此签名
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
