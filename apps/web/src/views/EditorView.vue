<script setup lang="ts">
import type { ImportedPdf } from '@/services/pdf-import'
import { CircleAlert, Download, FileText, FolderOpen, MousePointerClick, Plus, ShieldAlert, SlidersHorizontal, X } from '@lucide/vue'
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppLogo from '@/components/AppLogo.vue'
import ExportDialog from '@/components/ExportDialog.vue'
import PdfViewer from '@/components/pdf/PdfViewer.vue'
import PdfFileButton from '@/components/PdfFileButton.vue'
import SignatureDialog from '@/components/signature/SignatureDialog.vue'
import SignatureLayer from '@/components/signature/SignatureLayer.vue'
import SignaturePanel from '@/components/signature/SignaturePanel.vue'
import { downloadBytes, signedFileName } from '@/services/download'
import { useSigningStore } from '@/stores/signing'

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

const signing = useSigningStore()
const creating = ref(false)
const toolsOpen = ref(false)
watch(() => signing.armedSourceId, (sourceId) => {
  if (sourceId)
    toolsOpen.value = false
})

function createSignature() {
  toolsOpen.value = false
  creating.value = true
}

const armed = computed(() => signing.armedSourceId !== null)
const armedNoun = computed(() => (signing.armedSourceId && signing.sourceOf(signing.armedSourceId)?.kind === 'date' ? '日期' : '签名'))

function onCreate(kind: 'draw' | 'image' | 'date', image: Parameters<typeof signing.addSource>[1], libraryId?: string) {
  signing.arm((libraryId ? signing.addFromLibrary(libraryId, image) : signing.addSource(kind, image)).id)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && armed.value)
    signing.arm(null)
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const exportFileName = computed(() => signedFileName(props.doc.fileName))
const exportOpen = ref(false)
const exporting = ref(false)
const exportError = ref<string | null>(null)
const signedPages = computed(() => new Set(signing.placements.map(p => p.pageIndex)).size)

function startExport() {
  exportError.value = null
  exportOpen.value = true
}

/** Re-composes from the original bytes every time (PRD §7) and downloads the result. */
async function runExport() {
  exporting.value = true
  exportError.value = null
  try {
    const { exportSignedPdf } = await import('@/services/pdf-exporter')
    const { bytes } = await exportSignedPdf({
      originalBytes: props.doc.bytes,
      pages: props.doc.pages.map(page => page.geometry),
      images: new Map(signing.sources.map(source => [source.id, source.pngBytes])),
      placements: signing.placements,
    })
    downloadBytes(bytes, exportFileName.value, 'application/pdf')
    signing.markExported()
    exportOpen.value = false
  }
  catch {
    exportError.value = '导出失败，请重试或尝试较小的 PDF。'
  }
  finally {
    exporting.value = false
  }
}
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
      <Button size="sm" :disabled="!signing.placements.length" :title="signing.placements.length ? undefined : '请先放置签名'" @click="startExport">
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

    <div class="relative flex min-h-0 flex-1 max-md:flex-col">
      <PdfViewer :pdf="doc.pdf" :pages="doc.pages" class="min-w-0 flex-1">
        <template #page="{ pageIndex, page }">
          <SignatureLayer :page-index="pageIndex" :page="page" />
        </template>
      </PdfViewer>
      <SignaturePanel
        id="signature-tools"
        :pages="doc.pages"
        class="shrink-0 border-sidebar-border max-md:max-h-[50svh] max-md:border-t md:w-64 md:border-l"
        :class="!toolsOpen && 'max-md:hidden'"
        @create="createSignature"
      />

      <div v-if="armed" class="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3" role="status">
        <div class="pointer-events-auto flex items-center gap-2 rounded-full bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-lg">
          <MousePointerClick class="size-4" aria-hidden="true" />
          点击页面放置{{ armedNoun }}
          <button
            type="button"
            class="rounded-full px-2.5 py-0.5 text-xs text-background/80 outline-none hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background"
            @click="signing.arm(null)"
          >
            取消 <kbd class="ml-0.5 font-sans opacity-70 max-sm:hidden">Esc</kbd>
          </button>
        </div>
      </div>
    </div>

    <nav aria-label="签名操作" class="flex shrink-0 gap-2 border-t bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      <Button class="min-h-11 flex-1" @click="createSignature">
        <Plus aria-hidden="true" />
        添加签名
      </Button>
      <Button variant="outline" class="min-h-11 flex-1" aria-controls="signature-tools" :aria-expanded="toolsOpen" @click="toolsOpen = !toolsOpen">
        <SlidersHorizontal aria-hidden="true" />
        {{ toolsOpen ? '收起工具' : signing.selected ? '编辑选中项' : '签名与日期' }}
      </Button>
    </nav>

    <SignatureDialog v-model:open="creating" @create="onCreate" />
    <ExportDialog
      v-model:open="exportOpen"
      :file-name="exportFileName"
      :placements="signing.placements.length"
      :pages="signedPages"
      :busy="exporting"
      :error="exportError"
      @confirm="runExport"
    />

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
