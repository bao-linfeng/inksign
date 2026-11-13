<script setup lang="ts">
import { CircleAlert, FileUp, PenLine } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import { Spinner } from '@repo/ui/components/spinner'
import { defineAsyncComponent, ref } from 'vue'

import AppLogo from '@/components/AppLogo.vue'
import PdfFileButton from '@/components/PdfFileButton.vue'
import { useLibraryStore } from '@/stores/library'

defineProps<{
  /** A PDF is being read and checked */
  loading?: boolean
  /** Why the last file could not be opened */
  error?: string | null
  /** A file is being dragged over the window (dropping is handled by the app) */
  dragging?: boolean
}>()
const emit = defineEmits<{ select: [file: File] }>()
const SignatureDialog = defineAsyncComponent(() => import('@/components/signature/SignatureDialog.vue'))
const library = useLibraryStore()
const libraryOpen = ref(false)
void library.load()
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <header class="flex h-14 items-center justify-between px-4 sm:px-6">
      <AppLogo />
      <Button variant="ghost" size="sm" @click="libraryOpen = true">
        <PenLine aria-hidden="true" /> 我的签名（{{ library.entries.length }}）
      </Button>
    </header>

    <main class="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
        为 PDF 轻松添加手写签名
      </h1>
      <p class="mt-3 text-muted-foreground">
        无需注册 · 文件在本地处理 · 一键导出
      </p>

      <div
        class="mt-8 flex w-full max-w-md flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors"
        :class="dragging ? 'border-primary bg-accent' : 'border-border'"
      >
        <PdfFileButton size="lg" :disabled="loading" @select="emit('select', $event)">
          <Spinner v-if="loading" aria-label="正在打开" />
          <FileUp v-else aria-hidden="true" />
          {{ loading ? '正在打开…' : '选择 PDF 文件' }}
        </PdfFileButton>
        <p class="text-sm text-muted-foreground">
          {{ dragging ? '松开即可打开' : '或将 PDF 拖到此处' }}
        </p>
      </div>

      <Alert v-if="error" variant="destructive" class="mt-4 max-w-md text-left">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <p class="mt-10 max-w-md text-xs text-muted-foreground">
        本工具提供可视化签名，不等同于证书数字签名。
      </p>
    </main>
    <SignatureDialog v-if="libraryOpen" v-model:open="libraryOpen" save-only />
  </div>
</template>
