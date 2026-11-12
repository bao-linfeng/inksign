<script setup lang="ts">
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
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'

import { useFileDrop } from '@/composables/useFileDrop'
import { importErrorMessages } from '@/services/import-errors'
import { useDocumentStore } from '@/stores/document'
import { useSigningStore } from '@/stores/signing'
import HomeView from '@/views/HomeView.vue'

// The workspace (and with it PDF.js) loads only once a file is chosen (PRD §8)
const loadEditor = () => import('@/views/EditorView.vue')
const EditorView = defineAsyncComponent(loadEditor)

const store = useDocumentStore()
const signing = useSigningStore()
const errorMessage = computed(() => store.error && importErrorMessages[store.error])

// Signatures belong to the document they were placed on
watch(() => store.current, () => signing.reset())

/** A file waiting for the user to confirm that unexported signatures may be discarded (PRD §9) */
const pendingFile = shallowRef<File | null>(null)

function open(file: File) {
  if (store.current && signing.hasUnexported) {
    pendingFile.value = file
    return
  }
  // Fetch the workspace while the file is checked, so it is ready when the import finishes
  loadEditor().catch(() => {})
  void store.open(file)
}

function discardAndOpen() {
  const file = pendingFile.value
  pendingFile.value = null
  if (file) {
    signing.markExported()
    open(file)
  }
}

const { dragging } = useFileDrop(open)

// Best effort only: browsers decide whether to show the warning (PRD §9)
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (signing.hasUnexported)
    event.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <EditorView
    v-if="store.current"
    :key="store.revision"
    :doc="store.current"
    :loading="store.loading"
    :error="errorMessage"
    @select="open"
    @close="store.close"
    @dismiss-error="store.dismissError"
  />
  <HomeView v-else :loading="store.loading" :error="errorMessage" :dragging="dragging" @select="open" />

  <AlertDialog :open="pendingFile !== null">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>放弃未导出的签名？</AlertDialogTitle>
        <AlertDialogDescription>
          当前文件中还有尚未导出的签名，打开新文件后它们将被丢弃。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="pendingFile = null">
          返回
        </AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="discardAndOpen">
          放弃并打开
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
