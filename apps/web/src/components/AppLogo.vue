<script setup lang="ts">
import { PenLine } from '@lucide/vue'
</script>

<template>
  <span class="flex items-center gap-2">
    <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
      <PenLine class="size-4" aria-hidden="true" />
    </span>
    <span class="font-semibold tracking-tight">墨签</span>
    <span class="text-sm text-muted-foreground max-sm:hidden">InkSign</span>
  </span>
</template>
