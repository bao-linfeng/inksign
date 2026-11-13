<script setup lang="ts">
import type { StoredSignature } from '@/types/signature'
import { CircleAlert } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Spinner } from '@repo/ui/components/spinner'
import { computed, ref, watch } from 'vue'

import { isValidPin } from '@/services/signature-crypto'
import { vaultErrorMessage } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'

import PinHint from './PinHint.vue'

export type PinAction = 'unlock' | 'set' | 'change' | 'remove'

const props = defineProps<{
  entry: StoredSignature | null
  action: PinAction
}>()

const emit = defineEmits<{ done: [id: string] }>()
const open = defineModel<boolean>('open', { required: true })

const library = useLibraryStore()
const currentPin = ref('')
const newPin = ref('')
const repeatPin = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(open, (opened) => {
  currentPin.value = ''
  newPin.value = ''
  repeatPin.value = ''
  if (opened) {
    error.value = null
  }
})

const titles: Record<PinAction, string> = {
  unlock: '输入 PIN 解锁',
  set: '设置 PIN',
  change: '修改 PIN',
  remove: '移除 PIN',
}

const asksCurrent = computed(() => props.action !== 'set')
const asksNew = computed(() => props.action === 'set' || props.action === 'change')
const mismatch = computed(() => repeatPin.value !== '' && repeatPin.value !== newPin.value)
const ready = computed(() => {
  if (asksCurrent.value && !currentPin.value)
    return false
  return !asksNew.value || (isValidPin(newPin.value) && newPin.value === repeatPin.value)
})

async function confirm() {
  const entry = props.entry
  if (!entry || !ready.value || busy.value)
    return
  busy.value = true
  error.value = null
  try {
    if (props.action === 'unlock')
      await library.unlock(entry.id, currentPin.value)
    else
      await library.changePin(entry.id, asksCurrent.value ? currentPin.value : undefined, asksNew.value ? newPin.value : null)
    emit('done', entry.id)
    open.value = false
  }
  catch (caught) {
    error.value = vaultErrorMessage(caught)
    currentPin.value = ''
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
        <DialogTitle>{{ titles[action] }}</DialogTitle>
        <DialogDescription>
          “{{ entry?.name }}”
          <template v-if="action === 'unlock'">
            已设置 PIN，解锁后在本次访问中可直接使用，关闭页面或点击“锁定”后需重新输入。
          </template>
          <template v-else-if="action === 'remove'">
            移除后签名不再需要 PIN，任何使用此浏览器的人都能直接使用。
          </template>
          <template v-else>
            设置后，使用此签名前需要输入 PIN。
          </template>
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="confirm">
        <div v-if="asksCurrent" class="flex flex-col gap-2">
          <Label for="pin-current">{{ action === 'unlock' ? 'PIN' : '当前 PIN' }}</Label>
          <Input id="pin-current" v-model="currentPin" type="password" autocomplete="off" :disabled="busy" autofocus />
        </div>
        <template v-if="asksNew">
          <div class="flex flex-col gap-2">
            <Label for="pin-new">新 PIN</Label>
            <Input id="pin-new" v-model="newPin" type="password" autocomplete="off" :disabled="busy" :aria-invalid="newPin !== '' && !isValidPin(newPin)" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="pin-repeat">再次输入新 PIN</Label>
            <Input id="pin-repeat" v-model="repeatPin" type="password" autocomplete="off" :disabled="busy" :aria-invalid="mismatch" />
            <p v-if="mismatch" class="text-xs text-destructive">
              两次输入的 PIN 不一致。
            </p>
          </div>
          <PinHint />
        </template>

        <Alert v-if="error" variant="destructive" class="py-2">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" variant="outline" :disabled="busy" @click="open = false">
            取消
          </Button>
          <Button type="submit" :variant="action === 'remove' ? 'destructive' : 'default'" :disabled="!ready || busy">
            <Spinner v-if="busy" aria-label="正在处理" />
            {{ action === 'unlock' ? '解锁' : action === 'remove' ? '移除 PIN' : '确定' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
