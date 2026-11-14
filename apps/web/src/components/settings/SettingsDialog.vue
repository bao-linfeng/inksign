<script setup lang="ts">
import { CircleAlert, LockKeyhole } from '@lucide/vue'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import { Button } from '@repo/ui/components/button'
import { Checkbox } from '@repo/ui/components/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Spinner } from '@repo/ui/components/spinner'
import { computed, ref, watch } from 'vue'

import PinDialog from '@/components/library/PinDialog.vue'
import PinHint from '@/components/library/PinHint.vue'
import { isValidPin } from '@/services/signature-crypto'
import { vaultErrorMessage } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'

const open = defineModel<boolean>('open', { required: true })
const library = useLibraryStore()
const action = ref<'set' | 'change' | 'remove' | 'lock' | 'clear' | null>(null)
const currentPin = ref('')
const newPin = ref('')
const repeatPin = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const saved = ref('')
const unlockOpen = ref(false)
const legacyId = ref<string | null>(null)
const legacyTarget = computed(() => library.legacyEntries.find(entry => entry.id === legacyId.value) ?? null)
const legacyLocked = computed(() => library.legacyEntries.some(entry => library.isLocked(entry)))
const ready = computed(() => !legacyLocked.value && (!library.pinEnabled || !!currentPin.value) && (action.value === 'remove' || (isValidPin(newPin.value) && newPin.value === repeatPin.value)))

void library.load()

watch(action, () => {
  currentPin.value = ''
  newPin.value = ''
  repeatPin.value = ''
  error.value = null
  saved.value = ''
})

async function preference(key: 'autoSave' | 'rememberUnlock', value: boolean | 'indeterminate') {
  if (busy.value)
    return
  busy.value = true
  error.value = null
  saved.value = ''
  try {
    await library.preferences({ [key]: value === true })
    saved.value = '设置已保存'
  }
  catch (caught) {
    error.value = vaultErrorMessage(caught)
  }
  finally {
    busy.value = false
  }
}

async function confirm() {
  if (busy.value || (action.value !== 'lock' && action.value !== 'clear' && !ready.value))
    return
  busy.value = true
  error.value = null
  try {
    if (action.value === 'lock')
      await library.lock()
    else if (action.value === 'clear')
      await library.clear()
    else
      await library.setPin(currentPin.value, action.value === 'remove' ? null : newPin.value)
    action.value = null
    saved.value = '设置已保存'
  }
  catch (caught) {
    error.value = vaultErrorMessage(caught)
  }
  finally {
    busy.value = false
  }
}

function unlockLegacy(id: string) {
  legacyId.value = id
  unlockOpen.value = true
}
</script>

<template>
  <Dialog :open="open" @update:open="!busy && (open = $event)">
    <DialogContent class="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-w-lg" :show-close-button="!busy">
      <DialogHeader>
        <DialogTitle>设置</DialogTitle>
        <DialogDescription>仅对当前浏览器生效，自动记住你的选择。</DialogDescription>
      </DialogHeader>

      <p v-if="library.status === 'loading' || library.status === 'idle'" class="flex items-center gap-2 py-6 text-sm" role="status">
        <Spinner /> 正在读取设置…
      </p>
      <template v-else-if="library.available">
        <section class="flex flex-col gap-3 border-b pb-5" aria-labelledby="storage-settings-title">
          <h3 id="storage-settings-title" class="text-sm font-semibold">
            签名保存
          </h3>
          <label class="flex items-start justify-between gap-4">
            <span class="text-sm">自动保存新签名<span class="mt-1 block text-xs leading-relaxed text-muted-foreground">开启后，使用新签名时一并保存到本浏览器。</span></span>
            <Checkbox class="mt-0.5" :model-value="library.settings.autoSave" :disabled="busy" @update:model-value="preference('autoSave', $event)" />
          </label>
          <p class="text-xs leading-relaxed text-muted-foreground">
            签名仅保存在本浏览器，清理站点数据或无痕访问结束可能丢失。建议下载 PNG 备份，请勿在公共或共用设备开启自动保存。
          </p>
        </section>

        <section class="flex flex-col gap-3 border-b pb-5" aria-labelledby="pin-settings-title">
          <div class="flex items-center justify-between gap-3">
            <h3 id="pin-settings-title" class="text-sm font-semibold">
              签名库 PIN
            </h3>
            <span class="text-xs text-muted-foreground">{{ library.pinEnabled ? library.locked ? '已锁定' : '已解锁' : '未设置' }}</span>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">
            设置一次，保护全部已保存签名；以后新保存的签名自动沿用。
          </p>
          <div v-if="!action" class="flex flex-wrap gap-2">
            <Button v-if="!library.pinEnabled" variant="outline" size="sm" :disabled="!library.canEncrypt || busy" @click="action = 'set'">
              设置 PIN
            </Button>
            <template v-else>
              <Button v-if="library.locked" variant="outline" size="sm" :disabled="busy" @click="legacyId = null; unlockOpen = true">
                解锁签名库
              </Button>
              <Button variant="outline" size="sm" :disabled="busy" @click="action = 'change'">
                修改 PIN
              </Button>
              <Button variant="ghost" size="sm" :disabled="busy" @click="action = 'remove'">
                移除 PIN
              </Button>
            </template>
            <Button v-if="library.hasUnlocked || (library.pinEnabled && !library.locked)" variant="ghost" size="sm" :disabled="busy" @click="action = 'lock'">
              <LockKeyhole aria-hidden="true" /> 锁定
            </Button>
          </div>
          <p v-if="!library.canEncrypt" class="text-xs text-muted-foreground">
            当前环境不支持 PIN 加密，请使用 HTTPS 或本机 localhost。
          </p>

          <div v-if="library.legacyEntries.length" class="flex flex-col gap-2 rounded-md bg-muted p-3">
            <p class="text-xs leading-relaxed text-muted-foreground">
              已有签名使用旧版独立 PIN。请分别解锁后设置统一 PIN，原签名会保留。
            </p>
            <div v-for="entry in library.legacyEntries" :key="entry.id" class="flex items-center justify-between gap-3 text-sm">
              <span class="truncate">{{ entry.name }}</span>
              <Button v-if="library.isLocked(entry)" variant="outline" size="sm" @click="unlockLegacy(entry.id)">
                解锁旧签名
              </Button>
              <span v-else class="shrink-0 text-xs text-muted-foreground">可迁移</span>
            </div>
          </div>

          <form v-if="action" class="flex flex-col gap-3" @submit.prevent="confirm">
            <p v-if="action === 'lock'" class="text-sm leading-relaxed">
              锁定会清除记住的解锁状态，并移除当前 PDF 中受保护签名的全部放置。请先导出需要保留的内容。
            </p>
            <p v-else-if="action === 'clear'" class="text-sm leading-relaxed">
              将删除本浏览器保存的全部签名、PIN 和解锁记忆，并移除当前 PDF 中相关签名的全部放置。此操作无法撤销，请先导出 PDF 或下载 PNG 备份。
            </p>
            <template v-else>
              <p v-if="action === 'remove'" class="text-sm leading-relaxed">
                移除后，全部签名将不再加密，任何使用此浏览器的人都能直接使用。
              </p>
              <div v-if="library.pinEnabled" class="flex flex-col gap-2">
                <Label for="settings-current-pin">当前 PIN</Label>
                <Input id="settings-current-pin" v-model="currentPin" type="password" autocomplete="off" :disabled="busy" />
              </div>
              <template v-if="action !== 'remove'">
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="flex flex-col gap-2">
                    <Label for="settings-new-pin">新 PIN</Label>
                    <Input id="settings-new-pin" v-model="newPin" type="password" autocomplete="off" :disabled="busy" :aria-invalid="newPin !== '' && !isValidPin(newPin)" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="settings-repeat-pin">再次输入 PIN</Label>
                    <Input id="settings-repeat-pin" v-model="repeatPin" type="password" autocomplete="off" :disabled="busy" :aria-invalid="repeatPin !== '' && repeatPin !== newPin" />
                  </div>
                </div>
                <p v-if="repeatPin && repeatPin !== newPin" class="text-xs text-destructive">
                  两次输入的 PIN 不一致。
                </p>
                <PinHint />
              </template>
            </template>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" :disabled="busy" @click="action = null">
                取消
              </Button>
              <Button type="submit" size="sm" :variant="action === 'remove' || action === 'lock' || action === 'clear' ? 'destructive' : 'default'" :disabled="busy || (action !== 'lock' && action !== 'clear' && !ready)">
                <Spinner v-if="busy" aria-label="正在处理" />
                {{ action === 'lock' ? '锁定并移除放置' : action === 'clear' ? '确认删除' : action === 'remove' ? '确认移除 PIN' : '保存 PIN' }}
              </Button>
            </div>
          </form>

          <label class="flex items-start justify-between gap-4">
            <span class="text-sm">在此浏览器记住解锁状态<span class="mt-1 block text-xs leading-relaxed text-muted-foreground">仅保存不可导出的本地密钥，不保存 PIN。锁定后清除记忆。</span></span>
            <Checkbox class="mt-0.5" :model-value="library.settings.rememberUnlock" :disabled="busy" @update:model-value="preference('rememberUnlock', $event)" />
          </label>
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="local-data-title">
          <h3 id="local-data-title" class="text-sm font-semibold">
            本地数据
          </h3>
          <p class="text-xs leading-relaxed text-muted-foreground">
            已保存 {{ library.entries.length }} / 20 个签名。{{ library.persisted ? '已获持久化存储授权，主动清除站点数据仍会删除签名。' : '浏览器可能自动清理存储，请保留 PNG 备份。' }} PDF 和文件名始终只在内存中处理。
          </p>
          <Button class="self-start text-destructive" variant="ghost" size="sm" :disabled="busy || !library.entries.length" @click="action = 'clear'">
            清空全部签名
          </Button>
        </section>
      </template>
      <Alert v-else variant="destructive">
        <CircleAlert aria-hidden="true" /><AlertDescription>当前浏览器无法保存设置或签名，仍可临时签署并下载 PNG。</AlertDescription>
      </Alert>

      <Alert v-if="error" variant="destructive">
        <CircleAlert aria-hidden="true" /><AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <p class="min-h-4 text-xs text-muted-foreground" role="status">
        {{ saved }}
      </p>
      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="open = false">
          完成
        </Button>
      </DialogFooter>
      <PinDialog v-model:open="unlockOpen" :entry="legacyTarget" />
    </DialogContent>
  </Dialog>
</template>
