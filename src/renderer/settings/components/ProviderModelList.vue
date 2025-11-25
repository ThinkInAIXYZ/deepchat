<template>
  <div class="flex flex-col w-full gap-2">
    <Input v-model="modelSearchQuery" :placeholder="t('model.search.placeholder')" />
    <div class="text-xs text-muted-foreground px-2">{{ t('model.type.custom') }}</div>
    <div
      v-show="filteredCustomModels.length > 0"
      class="flex flex-col w-full border overflow-hidden rounded-lg"
    >
      <ModelConfigItem
        v-for="model in filteredCustomModels"
        :key="model.name"
        :model-name="model.name"
        :model-id="model.id"
        :provider-id="model.providerId"
        :enabled="model.enabled ?? false"
        :is-custom-model="true"
        :vision="model.vision"
        :function-call="model.functionCall"
        :reasoning="model.reasoning"
        :enable-search="model.enableSearch"
        :type="model.type ?? ModelType.Chat"
        @enabled-change="(enabled) => handleModelEnabledChange(model, enabled)"
        @delete-model="() => handleDeleteCustomModel(model)"
        @config-changed="$emit('config-changed')"
      />
    </div>
    <div class="flex flex-row justify-start">
      <Button
        variant="outline"
        size="sm"
        class="text-xs text-normal rounded-lg"
        :disabled="!primaryProviderId"
        @click="openAddModelDialog"
      >
        <Icon icon="lucide:plus" class="w-4 h-4 text-muted-foreground" />
        {{ t('model.actions.add') }}
      </Button>
    </div>
    <div class="text-xs text-muted-foreground px-2">{{ t('model.type.official') }}</div>
    <div v-for="provider in filteredProviderModels" :key="provider.providerId" class="mb-4">
      <div
        v-show="provider.models.length > 0"
        class="flex justify-between items-center text-sm font-medium mb-2"
      >
        <span>{{ getProviderName(provider.providerId) }}</span>
        <div class="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-normal rounded-lg"
            @click="enableAllModels(provider.providerId)"
          >
            <Icon icon="lucide:check-circle" class="w-3.5 h-3.5 mr-1" />
            {{ t('model.actions.enableAll') }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-normal rounded-lg"
            @click="disableAllModels(provider.providerId)"
          >
            <Icon icon="lucide:x-circle" class="w-3.5 h-3.5 mr-1" />
            {{ t('model.actions.disableAll') }}
          </Button>
        </div>
      </div>
      <div
        v-show="provider.models.length > 0"
        class="flex flex-col w-full border overflow-hidden rounded-lg"
      >
        <ModelConfigItem
          v-for="model in provider.models"
          :key="model.id"
          :model-name="model.name"
          :model-id="model.id"
          :provider-id="provider.providerId"
          :enabled="model.enabled ?? false"
          :vision="model.vision"
          :function-call="model.functionCall"
          :reasoning="model.reasoning"
          :enable-search="model.enableSearch"
          :type="model.type ?? ModelType.Chat"
          @enabled-change="(enabled) => handleModelEnabledChange(model, enabled)"
          @config-changed="$emit('config-changed')"
        />
      </div>
    </div>

    <ModelConfigDialog
      v-if="primaryProviderId"
      v-model:open="showAddModelDialog"
      model-id=""
      model-name=""
      :provider-id="primaryProviderId"
      mode="create"
      :is-custom-model="true"
      @saved="handleAddModelSaved"
    />
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import ModelConfigItem from '@/components/settings/ModelConfigItem.vue'
import ModelConfigDialog from '@/components/settings/ModelConfigDialog.vue'
import { type RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useModelStore } from '@/stores/modelStore'

const { t } = useI18n()
const modelSearchQuery = ref('')
const showAddModelDialog = ref(false)
const modelStore = useModelStore()

const props = defineProps<{
  providerModels: { providerId: string; models: RENDERER_MODEL_META[] }[]
  customModels: RENDERER_MODEL_META[]
  providers: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  enabledChange: [model: RENDERER_MODEL_META, enabled: boolean]
  'config-changed': []
}>()

const primaryProviderId = computed(() => props.providers[0]?.id ?? '')

const filteredProviderModels = computed(() => {
  if (!modelSearchQuery.value) {
    return props.providerModels
  }

  return props.providerModels
    .map((provider) => ({
      providerId: provider.providerId,
      models: provider.models.filter(
        (model) =>
          model.name.toLowerCase().includes(modelSearchQuery.value.toLowerCase()) ||
          model.id.toLowerCase().includes(modelSearchQuery.value.toLowerCase())
      )
    }))
    .filter((provider) => provider.models.length > 0)
})

const filteredCustomModels = computed(() => {
  const customModelsList: RENDERER_MODEL_META[] = []
  for (const model of props.customModels) {
    customModelsList.push(model)
  }

  if (!modelSearchQuery.value) {
    return customModelsList
  }

  const filteredModels: RENDERER_MODEL_META[] = []
  for (const model of customModelsList) {
    if (
      model.name.toLowerCase().includes(modelSearchQuery.value.toLowerCase()) ||
      model.id.toLowerCase().includes(modelSearchQuery.value.toLowerCase())
    ) {
      filteredModels.push(model)
    }
  }
  return filteredModels
})

const openAddModelDialog = () => {
  showAddModelDialog.value = true
}

const handleAddModelSaved = async () => {
  if (primaryProviderId.value) {
    await modelStore.refreshCustomModels(primaryProviderId.value)
  }
  emit('config-changed')
}

const getProviderName = (providerId: string) => {
  const provider = props.providers.find((p) => p.id === providerId)
  return provider?.name || providerId
}

const handleModelEnabledChange = async (model: RENDERER_MODEL_META, enabled: boolean) => {
  emit('enabledChange', model, enabled)
  await modelStore.updateModelStatus(model.providerId, model.id, enabled)
}

const handleDeleteCustomModel = async (model: RENDERER_MODEL_META) => {
  try {
    await modelStore.removeCustomModel(model.providerId, model.id)
  } catch (error) {
    console.error('Failed to delete custom model:', error)
  }
}

// 启用提供商下所有模型
const enableAllModels = (providerId: string) => {
  modelStore.enableAllModels(providerId)
}

// 禁用提供商下所有模型
const disableAllModels = (providerId: string) => {
  modelStore.disableAllModels(providerId)
}
</script>
