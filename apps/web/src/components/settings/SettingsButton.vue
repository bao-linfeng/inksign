<script setup lang="ts">
import { Settings2 } from '@lucide/vue'
import { Button } from '@repo/ui/components/button'
import { defineAsyncComponent, ref } from 'vue'

const SettingsDialog = defineAsyncComponent(() => import('./SettingsDialog.vue'))
const open = ref(false)
</script>

<template>
  <Button variant="ghost" size="sm" class="shrink-0 max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="设置" @click="open = true">
    <Settings2 aria-hidden="true" /><span class="max-sm:sr-only">设置</span>
  </Button>
  <SettingsDialog v-if="open" v-model:open="open" />
</template>
