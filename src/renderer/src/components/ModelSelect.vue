<template>
  <div class="space-y-2" :dir="langStore.dir">
    <Input
      v-model="keyword"
      class="w-full rounded-b-none border-none border-b text-sm ring-0 focus-visible:ring-0"
      :placeholder="t('model.search.placeholder')"
    />
    <div class="flex max-h-64 flex-col overflow-y-auto">
      <div v-for="provider in filteredProviders" :key="provider.id">
        <div class="px-2 text-xs text-muted-foreground">{{ provider.name }}</div>
        <div class="p-1">
          <div
            v-for="model in provider.models"
            :key="`${provider.id}-${model.id}`"
            :class="{ 'bg-muted': isSelected(provider.id, model.id) }"
            class="flex cursor-pointer flex-row items-center gap-1 rounded-md p-2 hover:bg-muted dark:hover:bg-accent"
            @click="handleModelSelect(provider.id, model)"
          >
            <ModelIcon
              v-if="provider.id === 'acp'"
              class="h-4 w-4"
              :model-id="model.id"
              :is-dark="themeStore.isDark"
            />
            <ModelIcon
              v-else
              class="h-4 w-4"
              :model-id="provider.id"
              :is-dark="themeStore.isDark"
            />
            <span class="flex-1 truncate text-xs font-bold">{{ model.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@shadcn/components/ui/input'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import ModelIcon from './icons/ModelIcon.vue'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { useSessionMode } from '@/components/chat-input/composables/useSessionMode'

const { t } = useI18n()
const keyword = ref('')
const providerStore = useProviderStore()
const modelStore = useModelStore()
const themeStore = useThemeStore()
const langStore = useLanguageStore()
const sessionMode = useSessionMode()

const emit = defineEmits<{
  (e: 'update:model', model: RENDERER_MODEL_META, providerId: string): void
}>()

const props = defineProps({
  type: {
    type: Array as PropType<ModelType[]>,
    default: undefined
  },
  excludeProviders: {
    type: Array as PropType<string[]>,
    default: () => []
  },
  visionOnly: {
    type: Boolean,
    default: false
  },
  selectedProviderId: {
    type: String,
    default: ''
  },
  selectedModelId: {
    type: String,
    default: ''
  }
})

const providers = computed(() => {
  const sortedProviders = providerStore.sortedProviders
  const enabledModels = modelStore.enabledModels
  const currentMode = sessionMode.currentMode.value

  return sortedProviders
    .filter((provider) => provider.enable && !props.excludeProviders.includes(provider.id))
    .map((provider) => {
      if (currentMode === 'acp agent' && provider.id !== 'acp') {
        return null
      }
      if (currentMode !== 'acp agent' && provider.id === 'acp') {
        return null
      }

      const enabledProvider = enabledModels.find((item) => item.providerId === provider.id)
      if (!enabledProvider || enabledProvider.models.length === 0) {
        return null
      }

      const filteredModels = enabledProvider.models.filter((model) => {
        const matchType =
          !props.type ||
          props.type.length === 0 ||
          (model.type !== undefined && props.type.includes(model.type as ModelType))
        const matchVision = !props.visionOnly || Boolean(model.vision)
        return matchType && matchVision
      })

      if (filteredModels.length === 0) {
        return null
      }

      return {
        id: provider.id,
        name: provider.name,
        models: filteredModels
      }
    })
    .filter(
      (provider): provider is { id: string; name: string; models: RENDERER_MODEL_META[] } =>
        provider !== null
    )
})

const filteredProviders = computed(() => {
  if (!keyword.value) {
    return providers.value
  }

  const lowerKeyword = keyword.value.toLowerCase()
  return providers.value
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.name.toLowerCase().includes(lowerKeyword))
    }))
    .filter((provider) => provider.models.length > 0)
})

const isSelected = (providerId: string, modelId: string) => {
  return props.selectedProviderId === providerId && props.selectedModelId === modelId
}

const handleModelSelect = (providerId: string, model: RENDERER_MODEL_META) => {
  emit('update:model', model, providerId)
}
</script>
