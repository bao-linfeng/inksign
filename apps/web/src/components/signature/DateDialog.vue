<script setup lang="ts">
import type { DateField, DateFormat } from '@/services/date-renderer'
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
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/radio-group'
import { computed, ref, watch } from 'vue'

import { DATE_FONT_FAMILY, DATE_FORMATS, formatDate, isValidIsoDate, loadDateFormat, saveDateFormat, todayIso } from '@/services/date-renderer'
import { INK_COLORS } from '@/services/signature-image'

const props = defineProps<{
  /** The date being edited; a new date starts from today */
  initial?: DateField | null
  /** Label of the confirm button */
  confirmLabel?: string
}>()

const emit = defineEmits<{ confirm: [field: DateField] }>()
const open = defineModel<boolean>('open', { required: true })

const value = ref('')
const format = ref<DateFormat>('zh')
const color = ref<string>(INK_COLORS[0].value)

watch(open, (opened) => {
  if (!opened)
    return
  value.value = props.initial?.value ?? todayIso()
  format.value = props.initial?.format ?? loadDateFormat()
  color.value = props.initial?.color ?? INK_COLORS[0].value
}, { immediate: true })

const valid = computed(() => isValidIsoDate(value.value))
/** Format examples follow the chosen date, or today while the input is incomplete */
const example = computed(() => (valid.value ? value.value : todayIso()))
const preview = computed(() => formatDate(example.value, format.value))

function confirm() {
  if (!valid.value)
    return
  saveDateFormat(format.value)
  emit('confirm', { value: value.value, format: format.value, color: color.value })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ initial ? '修改签署日期' : '签署日期' }}</DialogTitle>
        <DialogDescription>
          {{ initial ? '修改后，已放置的这个日期会一起更新。' : '日期以图片形式写入 PDF，可像签名一样拖动和缩放。' }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <Label for="date-value">日期</Label>
          <Input id="date-value" v-model="value" type="date" required :aria-invalid="!valid" />
          <p v-if="!valid" class="text-xs text-destructive">
            请选择一个有效日期。
          </p>
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 text-sm font-medium">
            格式
          </legend>
          <RadioGroup v-model="format" class="grid-cols-3 gap-2">
            <Label
              v-for="option in DATE_FORMATS"
              :key="option"
              class="cursor-pointer justify-center rounded-md border px-2 py-2.5 font-normal tabular-nums has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
            >
              <RadioGroupItem :value="option" class="sr-only" />
              {{ formatDate(example, option) }}
            </Label>
          </RadioGroup>
        </fieldset>

        <div class="flex flex-col gap-2">
          <span id="date-color" class="text-sm font-medium">颜色</span>
          <div class="flex items-center gap-2" role="radiogroup" aria-labelledby="date-color">
            <button
              v-for="option in INK_COLORS"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="color === option.value"
              :aria-label="option.name"
              :title="option.name"
              class="size-7 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="color === option.value && 'ring-2 ring-primary'"
              :style="{ backgroundColor: option.value }"
              @click="color = option.value"
            />
          </div>
        </div>

        <!-- Same font and colour as the rendered image -->
        <div class="grid h-20 place-items-center rounded-lg border bg-white" aria-hidden="true">
          <span class="text-2xl font-medium" :style="{ fontFamily: DATE_FONT_FAMILY, color }">{{ preview }}</span>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">
          取消
        </Button>
        <Button :disabled="!valid" @click="confirm">
          {{ confirmLabel ?? (initial ? '更新日期' : '使用此日期') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
