<script setup lang="ts">
import type { ImportedPdf } from '@/services/pdf-import'
import { CircleAlert, Download, FileText, FolderOpen, ShieldAlert, X } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@repo/ui/components/alert-dialog'
import { Button } from '@repo/ui/components/button'
import { Spinner } from '@repo/ui/components/spinner'
import { computed, ref } from 'vue'

import AppLogo from '@/components/AppLogo.vue'
import PdfViewer from '@/components/pdf/PdfViewer.vue'
import PdfFileButton from '@/components/PdfFileButton.vue'

const props = defineProps<{
  doc: ImportedPdf
  /** Another PDF is being opened to replace this one */
  loading?: boolean
  /** Why that PDF could not be opened; the current one stays */
  error?: string | null
}>()

const emit = defineEmits<{
  select: [file: File]
  close: []
  dismissError: []
}>()

const fileInfo = computed(() => {
  const megabytes = props.doc.bytes.length / 1024 / 1024
  const size = megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(megabytes * 1024))} KB`
  return `${props.doc.pages.length} 页 · ${size}`
})

const certified = computed(() => props.doc.signatures.certification !== undefined)
const approvalSigned = computed(() => !certified.value && props.doc.signatures.signedFields > 0)

// PRD FR-01: signing breaks a certification, so the user has to accept that first
const certificationAccepted = ref(false)
const confirmingCertification = computed(() => certified.value && !certificationAccepted.value)
</script>

<template>
  <div class="flex h-svh flex-col">
    <header class="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-4">
      <AppLogo />
      <span class="h-6 w-px shrink-0 bg-border max-sm:hidden" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <span class="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground max-sm:hidden">
          <FileText class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0 leading-tight">
          <p class="truncate text-sm font-medium" :title="doc.fileName">
            {{ doc.fileName }}
          </p>
          <p class="text-xs text-muted-foreground tabular-nums">
            {{ fileInfo }}
          </p>
        </div>
      </div>
      <PdfFileButton variant="ghost" size="sm" :disabled="loading" @select="emit('select', $event)">
        <Spinner v-if="loading" aria-label="正在打开" />
        <FolderOpen v-else aria-hidden="true" />
        <span class="max-sm:sr-only">重新打开</span>
      </PdfFileButton>
      <!-- Enabled once signatures can be placed (M2) -->
      <Button size="sm" disabled>
        <Download aria-hidden="true" />
        <span class="max-sm:sr-only">导出 PDF</span>
      </Button>
    </header>

    <Alert v-if="error" variant="destructive" class="rounded-none border-x-0 border-t-0 bg-red-50 py-2">
      <CircleAlert aria-hidden="true" />
      <AlertDescription class="flex items-center justify-between gap-2">
        {{ error }}
        <Button variant="ghost" size="icon-xs" aria-label="关闭提示" @click="emit('dismissError')">
          <X />
        </Button>
      </AlertDescription>
    </Alert>

    <Alert v-if="approvalSigned" class="rounded-none border-x-0 border-t-0 border-amber-200 bg-amber-50 py-2 text-amber-900 *:data-[slot=alert-description]:text-amber-900" role="status">
      <ShieldAlert aria-hidden="true" />
      <AlertDescription>
        此文件已包含数字签名。添加签名后原签名本身不会被破坏，但阅读器可能提示签名后文档被修改。
      </AlertDescription>
    </Alert>
    <Alert v-else-if="certified && certificationAccepted" variant="destructive" class="rounded-none border-x-0 border-t-0 border-red-200 bg-red-50 py-2" role="status">
      <ShieldAlert aria-hidden="true" />
      <AlertDescription>此文件经过认证签名，添加签名后认证将显示为无效。</AlertDescription>
    </Alert>

    <PdfViewer :pdf="doc.pdf" :pages="doc.pages" class="flex-1" />

    <!-- Controlled: only the two buttons close it -->
    <AlertDialog :open="confirmingCertification">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>此文件经过认证签名</AlertDialogTitle>
          <AlertDialogDescription>
            添加签名后认证将显示为无效。原文件不会被修改，但导出的文件在阅读器中会提示认证失效。是否继续？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="emit('close')">
            换一个文件
          </AlertDialogCancel>
          <AlertDialogAction @click="certificationAccepted = true">
            继续签名
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
