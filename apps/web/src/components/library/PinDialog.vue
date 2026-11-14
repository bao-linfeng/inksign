<script setup lang="ts">
import type { StoredSignature } from '@/types/signature'
import { CircleAlert } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Spinner } from '@repo/ui/components/spinner'
import { ref, watch } from 'vue'

import { vaultErrorMessage } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'

const props = defineProps<{ entry?: StoredSignature | null }>()
const emit = defineEmits<{ done: [id: string] }>()
const open = defineModel<boolean>('open', { required: true })
const library = useLibraryStore()
const pin = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(open, () => {
  pin.value = ''
  error.value = null
})

async function confirm() {
  if (!pin.value || busy.value)
    return
  busy.value = true
  error.value = null
  try {
    if (props.entry)
      await library.unlock(props.entry.id, pin.value)
    else
      await library.unlockVault(pin.value)
    emit('done', props.entry?.id ?? '')
    open.value = false
  }
  catch (caught) {
    error.value = vaultErrorMessage(caught)
    pin.value = ''
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="!busy && (open = $event)">
    <DialogContent class="max-h-[90svh] overflow-y-auto sm:max-w-sm" :show-close-button="!busy">
      <DialogHeader>
        <DialogTitle>输入 PIN 解锁</DialogTitle>
        <DialogDescription>
          {{ entry && entry.protection !== 'library' ? `解锁旧版签名“${entry.name}”。` : '解锁签名库后，本次访问可直接使用全部签名。' }}
        </DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="confirm">
        <div class="flex flex-col gap-2">
          <Label for="pin-current">PIN</Label>
          <Input id="pin-current" v-model="pin" type="password" autocomplete="off" :disabled="busy" autofocus />
        </div>
        <Alert v-if="error" variant="destructive" class="py-2">
          <CircleAlert aria-hidden="true" /><AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="outline" :disabled="busy" @click="open = false">
            取消
          </Button>
          <Button type="submit" :disabled="!pin || busy">
            <Spinner v-if="busy" aria-label="正在处理" /> 解锁
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
