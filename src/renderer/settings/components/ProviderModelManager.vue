<template>
  <div class="w-full rounded-2xl shadow-sm relative">
    <div class="flex w-full justify-between items-center sticky top-0 z-30 backdrop-blur">
      <div class="flex flex-col w-full gap-2">
        <Label :for="`${provider.id}-model`" class="flex-1 cursor-pointer">{{
          t('settings.provider.modelList')
        }}</Label>
        <div class="text-xs text-muted-foreground">
          {{ enabledModels.length }}/{{ totalModelsCount }}
          {{ t('settings.provider.modelsEnabled') }}
        </div>
      </div>
    </div>

    <div class="w-full">
      <ProviderModelList
        :provider-id="provider.id"
        :provider-models="providerModelGroups"
        :custom-models="customModels"
        :providers="providerOptions"
        @enabled-change="(model, enabled) => $emit('model-enabled-change', model, enabled)"
        @saved="$emit('custom-model-added')"
        @config-changed="$emit('config-changed')"
        :is-loading="isModelListLoading"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import ProviderModelList from './ProviderModelList.vue'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
  enabledModels: RENDERER_MODEL_META[]
  totalModelsCount: number
  providerModels: RENDERER_MODEL_META[]
  customModels: RENDERER_MODEL_META[]
  isModelListLoading?: boolean
}>()

const providerModelGroups = computed(() => [
  {
    providerId: props.provider.id,
    models: props.providerModels
  }
])

const providerOptions = computed(() => [
  {
    id: props.provider.id,
    name: props.provider.name
  }
])

defineEmits<{
  'disable-all-models': []
  'model-enabled-change': [model: RENDERER_MODEL_META, enabled: boolean]
  'config-changed': []
  'custom-model-added': []
}>()
</script>
