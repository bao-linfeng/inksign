<script setup lang="ts">
import { FileUp, PenLine } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { useTemplateRef } from 'vue'

const emit = defineEmits<{ select: [file: File] }>()

const fileInput = useTemplateRef('fileInput')

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset so choosing the same file again still fires change
  input.value = ''
  if (file)
    emit('select', file)
}
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <header class="flex items-center gap-2 px-6 py-4">
      <PenLine class="size-5 text-primary" aria-hidden="true" />
      <span class="font-semibold">墨签 InkSign</span>
    </header>

    <main class="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
        为 PDF 轻松添加手写签名
      </h1>
      <p class="mt-3 text-muted-foreground">
        无需注册 · 文件在本地处理 · 一键导出
      </p>

      <Button size="lg" class="mt-8" @click="fileInput?.click()">
        <FileUp aria-hidden="true" />
        选择 PDF 文件
      </Button>
      <input
        ref="fileInput"
        type="file"
        accept="application/pdf,.pdf"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        @change="onFileChange"
      >

      <p class="mt-10 max-w-md text-xs text-muted-foreground">
        本工具提供可视化签名，不等同于证书数字签名。
      </p>
    </main>
  </div>
</template>
