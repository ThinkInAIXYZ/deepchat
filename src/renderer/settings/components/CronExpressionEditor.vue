<template>
  <CronCore
    :model-value="modelValue"
    format="crontab"
    :locale="locale"
    @update:model-value="(value) => emit('update:modelValue', String(value))"
    @error="(error) => emit('error', String(error))"
  >
    <template #default="{ period, fields }">
      <div class="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <div class="min-w-0 space-y-1.5">
          <Label class="text-xs text-muted-foreground">
            {{ period.prefix || t('settings.cronJobs.fields.preset') }}
          </Label>
          <Select
            :model-value="period.attrs.modelValue"
            data-testid="cron-editor-period"
            @update:model-value="(value) => period.events['update:model-value'](String(value))"
          >
            <SelectTrigger class="h-8! w-full min-w-0">
              <SelectValue class="min-w-0 truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in period.items" :key="item.id" :value="item.id">
                {{ item.text }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-for="field in fields" :key="field.id" class="min-w-0 space-y-1.5">
          <Label class="truncate text-xs text-muted-foreground">
            {{ field.prefix || field.id }}
          </Label>
          <Select
            :model-value="getFieldSelectValue(field)"
            :data-testid="`cron-editor-field-${field.id}`"
            @update:model-value="(value) => updateField(field, String(value))"
          >
            <SelectTrigger class="h-8! w-full min-w-0">
              <SelectValue class="min-w-0 truncate" />
            </SelectTrigger>
            <SelectContent class="max-h-72">
              <SelectItem :value="EVERY_VALUE">*</SelectItem>
              <SelectItem v-if="isCustomFieldValue(field)" :value="CUSTOM_VALUE" disabled>
                {{ t('settings.cronJobs.presets.custom') }}: {{ field.cron }}
              </SelectItem>
              <SelectItem v-for="item in field.items" :key="item.value" :value="String(item.value)">
                {{ item.text }}
              </SelectItem>
            </SelectContent>
          </Select>
          <div class="truncate text-xs text-muted-foreground">
            {{ field.selectedStr }}
          </div>
        </div>
      </div>
    </template>
  </CronCore>
</template>

<script setup lang="ts">
import { CronCore } from '@vue-js-cron/core'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'

interface CronEditorField {
  id: string
  cron: string
  selectedStr: string
  attrs: {
    modelValue: number[]
  }
  events: {
    'update:model-value': (value: number[]) => void
  }
  prefix: string
  items: Array<{
    value: number
    text: string
  }>
}

defineProps<{
  modelValue: string
  locale: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  error: [value: string]
}>()

const { t } = useI18n()
const EVERY_VALUE = '__every__'
const CUSTOM_VALUE = '__custom__'

const isCustomFieldValue = (field: CronEditorField): boolean => {
  return field.cron !== '*' && field.attrs.modelValue.length !== 1
}

const getFieldSelectValue = (field: CronEditorField): string => {
  if (field.attrs.modelValue.length === 1) {
    return String(field.attrs.modelValue[0])
  }
  return field.cron === '*' ? EVERY_VALUE : CUSTOM_VALUE
}

const updateField = (field: CronEditorField, value: string) => {
  if (value === CUSTOM_VALUE) {
    return
  }
  field.events['update:model-value'](value === EVERY_VALUE ? [] : [Number(value)])
}
</script>
