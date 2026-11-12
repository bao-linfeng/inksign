<script setup lang="ts">
import { Button } from '@repo/ui/components/button'
import { useTemplateRef } from 'vue'

// Attributes (variant, size, disabled, class) go to the button, not the hidden input
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ select: [file: File] }>()

const input = useTemplateRef('input')

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  // Reset so choosing the same file again still fires change
  target.value = ''
  if (file)
    emit('select', file)
}
</script>

<template>
  <Button v-bind="$attrs" @click="input?.click()">
    <slot />
  </Button>
  <input
    ref="input"
    type="file"
    accept="application/pdf,.pdf"
    class="sr-only"
    tabindex="-1"
    aria-hidden="true"
    @change="onChange"
  >
</template>
