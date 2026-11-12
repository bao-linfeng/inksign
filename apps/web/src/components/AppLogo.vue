<script setup lang="ts">
// Bind public URLs so Vite leaves them unchanged in both the app and Windows tests.
const lightLogoUrl = '/brand/logo-light.svg'
const darkLogoUrl = '/brand/logo-dark.svg'
</script>

<template>
  <span class="flex items-center gap-2">
    <img :src="lightLogoUrl" class="size-8 shrink-0 rounded-lg shadow-sm dark:hidden" width="32" height="32" alt="">
    <img :src="darkLogoUrl" class="hidden size-8 shrink-0 rounded-lg shadow-sm dark:block" width="32" height="32" alt="">
    <span class="font-semibold tracking-tight">墨签</span>
    <span class="text-sm text-muted-foreground max-sm:hidden">InkSign</span>
  </span>
</template>
