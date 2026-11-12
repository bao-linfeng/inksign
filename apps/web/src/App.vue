<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'

import { useFileDrop } from '@/composables/useFileDrop'
import { importErrorMessages } from '@/services/import-errors'
import { useDocumentStore } from '@/stores/document'
import HomeView from '@/views/HomeView.vue'

// The workspace (and with it PDF.js) loads only once a file is chosen (PRD §8)
const loadEditor = () => import('@/views/EditorView.vue')
const EditorView = defineAsyncComponent(loadEditor)

const store = useDocumentStore()
const errorMessage = computed(() => store.error && importErrorMessages[store.error])

function open(file: File) {
  // Fetch the workspace while the file is checked, so it is ready when the import finishes
  loadEditor().catch(() => {})
  void store.open(file)
}

const { dragging } = useFileDrop(open)
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
</template>
