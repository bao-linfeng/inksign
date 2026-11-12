<script setup lang="ts">
import { CircleAlert, Download, Info } from '@lucide/vue'
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
import { Spinner } from '@repo/ui/components/spinner'

defineProps<{
  fileName: string
  placements: number
  pages: number
  busy: boolean
  error: string | null
}>()

defineEmits<{ confirm: [] }>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <Dialog :open="open" @update:open="!busy && (open = $event)">
    <DialogContent class="sm:max-w-md" :show-close-button="!busy">
      <DialogHeader>
        <DialogTitle>导出签名后的 PDF</DialogTitle>
        <DialogDescription>
          在 {{ pages }} 页上写入 {{ placements }} 处签名，另存为
          <span class="font-medium break-all text-foreground">{{ fileName }}</span>。原文件不会被修改。
        </DialogDescription>
      </DialogHeader>

      <!-- PRD FR-06 / FR-08: the legal notice belongs to the export confirmation -->
      <div class="flex gap-2.5 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          导出的是可视化签名，不等同于证书数字签名。图片形式的签名不具备证书数字签名的防篡改与身份认证能力。用于重要合同时，请与对方确认是否接受，必要时使用具备 CA 认证的电子签约平台。
        </p>
      </div>

      <Alert v-if="error" variant="destructive" class="py-2">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="open = false">
          取消
        </Button>
        <Button :disabled="busy" @click="$emit('confirm')">
          <Spinner v-if="busy" aria-label="正在导出" />
          <Download v-else aria-hidden="true" />
          {{ busy ? '正在导出…' : error ? '重试' : '导出并下载' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
