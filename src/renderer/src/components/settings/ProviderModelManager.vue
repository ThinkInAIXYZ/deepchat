<template>
  <div class="flex flex-col items-start gap-2">
    <Label :for="`${provider.id}-model`" class="flex-1 cursor-pointer">{{
      t('settings.provider.modelList')
    }}</Label>
    <div class="flex flex-row gap-2 items-center">
      <Button
        variant="outline"
        size="xs"
        class="text-xs text-normal rounded-lg"
        @click="$emit('show-model-list-dialog')"
      >
        <Icon icon="lucide:list-check" class="w-4 h-4 text-muted-foreground" />{{
          t('settings.provider.enableModels')
        }}
      </Button>
      <Button
        variant="outline"
        size="xs"
        class="text-xs text-normal rounded-lg"
        :disabled="enabledModels.length === 0"
        @click="$emit('disable-all-models')"
      >
        <Icon icon="lucide:x-circle" class="w-4 h-4 text-muted-foreground" />{{
          t('settings.provider.disableAllModels')
        }}
      </Button>
      <span class="text-xs text-muted-foreground">
        {{ enabledModels.length }}/{{ totalModelsCount }}
        {{ t('settings.provider.modelsEnabled') }}
      </span>
    </div>
    <div
      v-if="enabledModels.length > 0"
      class="flex flex-col w-full border overflow-hidden rounded-lg"
    >
      <ModelConfigItem
        v-for="model in enabledModels"
        :key="model.id"
        :model-name="model.name"
        :model-id="model.id"
        :provider-id="provider.id"
        :group="model.group"
        :enabled="model.enabled ?? false"
        :vision="model.vision ?? false"
        :function-call="model.functionCall ?? false"
        :reasoning="model.reasoning ?? false"
        :enable-search="model.enableSearch ?? false"
        :type="model.type ?? ModelType.Chat"
        @enabled-change="$emit('model-enabled-change', model, $event)"
        @config-changed="$emit('config-changed')"
      />
    </div>
    <div
      v-else-if="totalModelsCount > 0"
      class="flex flex-col w-full border border-dashed border-muted-foreground/30 rounded-lg p-4"
    >
      <div class="flex items-center gap-3 text-muted-foreground">
        <Icon icon="lucide:info" class="w-5 h-5 text-blue-500" />
        <div class="flex-1">
          <p class="text-sm font-medium">
            {{ t('settings.provider.noModelsEnabled.title') }}
          </p>
          <p class="text-xs mt-1">
            {{ t('settings.provider.noModelsEnabled.description') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import ModelConfigItem from './ModelConfigItem.vue'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'

const { t } = useI18n()

defineProps<{
  provider: LLM_PROVIDER
  enabledModels: RENDERER_MODEL_META[]
  totalModelsCount: number
}>()

defineEmits<{
  'show-model-list-dialog': []
  'disable-all-models': []
  'model-enabled-change': [model: RENDERER_MODEL_META, enabled: boolean]
  'config-changed': []
}>()
</script>
