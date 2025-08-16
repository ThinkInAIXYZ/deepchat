<template>
  <div class="space-y-2" :dir="langStore.dir">
    <Input
      v-model="keyword"
      class="w-full border-none border-b ring-0 focus-visible:ring-0 rounded-b-none"
      :placeholder="t('model.search.placeholder')"
    />
    <div class="flex flex-col max-h-64 overflow-y-auto">
      <div v-for="provider in filteredProviders" :key="provider.id">
        <div class="text-xs text-muted-foreground px-2">{{ provider.name }}</div>
        <div class="p-1">
          <div
            v-for="model in provider.models"
            :key="`${provider.id}-${model.id}`"
            :class="{ 'bg-muted': isSelected(provider.id, model.id) }"
            class="flex flex-row items-center gap-1 p-2 hover:bg-muted dark:hover:bg-accent rounded-md cursor-pointer"
            @click="handleModelSelect(provider.id, model)"
          >
            <ModelIcon
              class="w-4 h-4"
              :model-id="provider.id"
              :is-dark="themeStore.isDark"
            ></ModelIcon>
            <span class="text-xs font-bold truncate flex-1">{{ model.name }}</span>
            <!-- <Badge
              v-for="tag in getModelTags(model)"
              :key="tag"
              variant="outline"
              class="py-0 rounded-lg"
              size="xs"
              >{{ tag }}</Badge
            > -->
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ref, computed, PropType } from 'vue'
import Input from './ui/input/Input.vue'
// import Badge from './ui/badge/Badge.vue'
import { useChatStore } from '@/stores/chat'
import { type RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import ModelIcon from './icons/ModelIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
const { t } = useI18n()
const keyword = ref('')
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const langStore = useLanguageStore()
const emit = defineEmits<{
  (e: 'update:model', model: RENDERER_MODEL_META, providerId: string): void
}>()

const props = defineProps({
  type: {
    type: Array as PropType<ModelType[]>,
    default: undefined // ←  explicit for clarity
  }
})
const providers = computed(() => {
  const sortedProviders = settingsStore.sortedProviders
  const enabledModels = settingsStore.enabledModels
  const orderedProviders = sortedProviders
    .filter((provider) => provider.enable)
    .map((provider) => {
      const enabledProvider = enabledModels.find((ep) => ep.providerId === provider.id)
      if (!enabledProvider || enabledProvider.models.length === 0) {
        return null
      }

      return {
        id: provider.id,
        name: provider.name,
        models:
          !props.type || props.type.length === 0
            ? enabledProvider.models
            : enabledProvider.models.filter(
                (model) => model.type !== undefined && props.type!.includes(model.type as ModelType)
              )
      }
    })
    .filter(
      (provider): provider is { id: string; name: string; models: RENDERER_MODEL_META[] } =>
        provider !== null && provider.models.length > 0
    )

  return orderedProviders
})

const filteredProviders = computed(() => {
  if (!keyword.value) return providers.value.filter((provider) => provider.models.length > 0)
  return providers.value
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) =>
        model.name.toLowerCase().includes(keyword.value.toLowerCase())
      )
    }))
    .filter((provider) => provider.models.length > 0)
})

const isSelected = (providerId: string, modelId: string) => {
  return chatStore.chatConfig.providerId === providerId && chatStore.chatConfig.modelId === modelId
}

const handleModelSelect = async (providerId: string, model: RENDERER_MODEL_META) => {
  // await chatStore.updateChatConfig({
  //   providerId,
  //   modelId: model.id,
  //   contextLength: model.contextLength,
  //   maxTokens: model.maxTokens
  // })
  emit('update:model', model, providerId)
}

// const getModelTags = (model: MODEL_META) => {
//   const tags: string[] = []
//   if (model.group) tags.push(model.group)
//   if (model.description) tags.push(model.description)
//   return tags
// }
</script>
