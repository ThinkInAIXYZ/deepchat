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
    <div v-for="(model, idx) in addModelList" :key="idx" class="flex flex-row gap-2 items-center">
      <Input v-model="model.modelName" :placeholder="t('model.add.namePlaceholder')" />
      <Input v-model="model.modelId" :placeholder="t('model.add.idPlaceholder')" />
      <Input
        v-model="model.contextLength"
        type="number"
        :placeholder="t('model.add.contextLengthPlaceholder')"
        class="w-32"
      />
      <Input
        v-model="model.maxTokens"
        type="number"
        :placeholder="t('model.add.maxTokensPlaceholder')"
        class="w-32"
      />
      <Select v-model="model.type" class="w-16">
        <SelectTrigger class="w-full">
          <div class="flex items-center gap-1">
            <SelectValue class="text-xs font-bold truncate" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="type in Object.values(ModelType)" :key="type" :value="type">
            {{ type }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        class="text-xs text-normal rounded-lg"
        @click="removeEdit(idx)"
        >{{ t('dialog.cancel') }}</Button
      >
      <Button
        variant="default"
        size="sm"
        class="text-xs text-normal rounded-lg text-primary-foreground"
        @click="confirmAdd(idx)"
        >{{ t('dialog.confirm') }}</Button
      >
    </div>
    <div class="flex flex-row justify-start">
      <Button variant="outline" size="xs" class="text-xs text-normal rounded-lg" @click="addEdit">
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
            size="xs"
            class="text-xs text-normal rounded-lg"
            @click="enableAllModels(provider.providerId)"
          >
            <Icon icon="lucide:check-circle" class="w-3.5 h-3.5 mr-1" />
            {{ t('model.actions.enableAll') }}
          </Button>
          <Button
            variant="outline"
            size="xs"
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
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Icon } from '@iconify/vue'
import ModelConfigItem from './ModelConfigItem.vue'
import { type RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
interface ModelEdit {
  modelName: string
  modelId: string
  contextLength: number
  maxTokens: number
  type: ModelType
}

const addModelList = ref<ModelEdit[]>([])
const modelSearchQuery = ref('')
const settingsStore = useSettingsStore()

const props = defineProps<{
  providerModels: { providerId: string; models: RENDERER_MODEL_META[] }[]
  customModels: RENDERER_MODEL_META[]
  providers: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  enabledChange: [model: RENDERER_MODEL_META, enabled: boolean]
  'config-changed': []
}>()

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

const getProviderName = (providerId: string) => {
  const provider = props.providers.find((p) => p.id === providerId)
  return provider?.name || providerId
}

const addEdit = () => {
  addModelList.value.push({
    modelName: '',
    modelId: '',
    contextLength: 4096,
    maxTokens: 2048,
    type: ModelType.Chat
  })
}

const removeEdit = (idx: number) => {
  addModelList.value.splice(idx, 1)
}

const confirmAdd = async (idx: number) => {
  const model = addModelList.value[idx]
  if (!model.modelId || !model.modelName) {
    console.error('模型ID和名称为必填项')
    return
  }

  try {
    await settingsStore.addCustomModel(props.providers[0].id, {
      id: model.modelId,
      name: model.modelName,
      enabled: true,
      contextLength: model.contextLength || 4096,
      maxTokens: model.maxTokens || 2048,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: model.type
    })
    removeEdit(idx)
  } catch (error) {
    console.error('Failed to add custom model:', error)
  }
}

const handleModelEnabledChange = (model: RENDERER_MODEL_META, enabled: boolean) => {
  emit('enabledChange', model, enabled)
}

const handleDeleteCustomModel = async (model: RENDERER_MODEL_META) => {
  try {
    await settingsStore.removeCustomModel(model.providerId, model.id)
  } catch (error) {
    console.error('Failed to delete custom model:', error)
  }
}

// 启用提供商下所有模型
const enableAllModels = (providerId: string) => {
  settingsStore.enableAllModels(providerId)
}

// 禁用提供商下所有模型
const disableAllModels = (providerId: string) => {
  settingsStore.disableAllModels(providerId)
}
</script>
