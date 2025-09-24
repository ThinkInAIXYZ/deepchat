<template>
  <div class="flex flex-col items-start gap-2">
    <Label :for="`${provider.id}-azure-api-version`" class="flex-1 cursor-pointer">{{
      t('settings.provider.azureApiVersion', 'API Version')
    }}</Label>
    <Input
      :id="`${provider.id}-azure-api-version`"
      :model-value="azureApiVersion"
      placeholder="e.g., 2024-02-01"
      @blur="handleAzureApiVersionChange(String($event.target.value))"
      @keyup.enter="handleAzureApiVersionChange(azureApiVersion)"
      @update:model-value="azureApiVersion = String($event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import type { LLM_PROVIDER } from '@shared/presenter'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
  initialValue?: string
}>()

const emit = defineEmits<{
  'api-version-change': [value: string]
}>()

const azureApiVersion = ref(props.initialValue || '2024-02-01')

watch(
  () => props.initialValue,
  (newValue) => {
    if (newValue) {
      azureApiVersion.value = newValue
    }
  },
  { immediate: true }
)

const handleAzureApiVersionChange = (value: string) => {
  const trimmedValue = value.trim()
  if (trimmedValue) {
    azureApiVersion.value = trimmedValue
    emit('api-version-change', trimmedValue)
  }
}
</script>
