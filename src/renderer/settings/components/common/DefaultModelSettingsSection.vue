<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-center gap-2 h-10 text-sm font-medium text-muted-foreground">
      <Icon icon="lucide:sparkles" class="w-4 h-4" />
      <span>{{ t('settings.common.defaultModel.title') }}</span>
    </div>

    <div class="flex items-center gap-3 h-10">
      <span class="text-sm font-medium shrink-0 min-w-[220px]">{{
        t('settings.common.searchAssistantModel')
      }}</span>
      <div class="ml-auto flex items-center gap-2">
        <Popover v-model:open="assistantModelSelectOpen">
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              class="h-8 w-[320px] justify-between text-sm border-border hover:bg-accent"
            >
              <div class="flex items-center gap-2 min-w-0">
                <ModelIcon
                  v-if="selectedAssistantModel"
                  :model-id="selectedAssistantModel.providerId"
                  class="h-4 w-4"
                  :is-dark="themeStore.isDark"
                />
                <span class="truncate">{{
                  selectedAssistantModel?.model?.name || t('settings.common.selectModel')
                }}</span>
              </div>
              <ChevronDown class="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-[320px] p-0" align="end">
            <ModelSelect :exclude-providers="['acp']" @update:model="handleAssistantModelSelect" />
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <div class="flex items-center gap-3 h-10">
      <span class="text-sm font-medium shrink-0 min-w-[220px]">{{
        t('settings.common.defaultModel.chatModel')
      }}</span>
      <div class="ml-auto flex items-center gap-2">
        <Popover v-model:open="chatModelSelectOpen">
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              class="h-8 w-[320px] justify-between text-sm border-border hover:bg-accent"
            >
              <div class="flex items-center gap-2 min-w-0">
                <ModelIcon
                  v-if="selectedChatModel"
                  :model-id="selectedChatModel.providerId"
                  class="h-4 w-4"
                  :is-dark="themeStore.isDark"
                />
                <span class="truncate">{{
                  selectedChatModel?.model?.name || t('settings.common.selectModel')
                }}</span>
              </div>
              <ChevronDown class="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-[320px] p-0" align="end">
            <ModelSelect :exclude-providers="['acp']" @update:model="handleChatModelSelect" />
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <div class="flex items-center gap-3 h-10">
      <span class="text-sm font-medium shrink-0 min-w-[220px]">{{
        t('settings.common.defaultModel.visionModel')
      }}</span>
      <div class="ml-auto flex items-center gap-2">
        <Popover v-model:open="visionModelSelectOpen">
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              class="h-8 w-[320px] justify-between text-sm border-border hover:bg-accent"
            >
              <div class="flex items-center gap-2 min-w-0">
                <ModelIcon
                  v-if="selectedVisionModel"
                  :model-id="selectedVisionModel.providerId"
                  class="h-4 w-4"
                  :is-dark="themeStore.isDark"
                />
                <span class="truncate">{{
                  selectedVisionModel?.model?.name || t('settings.common.selectModel')
                }}</span>
              </div>
              <ChevronDown class="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-[320px] p-0" align="end">
            <ModelSelect
              :type="[ModelType.Chat, ModelType.ImageGeneration]"
              :vision-only="true"
              @update:model="handleVisionModelSelect"
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { ChevronDown } from 'lucide-vue-next'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'
import { useModelStore } from '@/stores/modelStore'
import { usePresenter } from '@/composables/usePresenter'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'

const { t } = useI18n()
const themeStore = useThemeStore()
const modelStore = useModelStore()
const configPresenter = usePresenter('configPresenter')

const assistantModelSelectOpen = ref(false)
const chatModelSelectOpen = ref(false)
const visionModelSelectOpen = ref(false)

interface SelectedModel {
  providerId: string
  model: RENDERER_MODEL_META
}

const selectedAssistantModel = ref<SelectedModel | null>(null)
const selectedChatModel = ref<SelectedModel | null>(null)
const selectedVisionModel = ref<SelectedModel | null>(null)
let isSyncingModelDefaults = false

const selectBySetting = (
  setting: { providerId: string; modelId: string } | undefined,
  predicate?: (model: RENDERER_MODEL_META, providerId: string) => boolean
): SelectedModel | null => {
  if (!setting?.providerId || !setting?.modelId) {
    return null
  }
  const providerEntry = modelStore.enabledModels.find(
    (item) => item.providerId === setting.providerId
  )
  if (!providerEntry) {
    return null
  }
  const matchedModel = providerEntry.models.find(
    (model) => model.id === setting.modelId && (!predicate || predicate(model, setting.providerId))
  )
  if (!matchedModel) {
    return null
  }
  return { providerId: setting.providerId, model: matchedModel }
}

const persistModelSetting = async (
  key: 'assistantModel' | 'defaultModel' | 'defaultVisionModel',
  previous: { providerId: string; modelId: string } | undefined,
  current: SelectedModel | null
): Promise<void> => {
  if (!current) {
    return
  }
  if (previous?.providerId === current.providerId && previous?.modelId === current.model.id) {
    return
  }
  await configPresenter.setSetting(key, {
    providerId: current.providerId,
    modelId: current.model.id
  })
}

const handleAssistantModelSelect = async (
  model: RENDERER_MODEL_META,
  providerId: string
): Promise<void> => {
  selectedAssistantModel.value = { providerId, model }
  await configPresenter.setSetting('assistantModel', { providerId, modelId: model.id })
  assistantModelSelectOpen.value = false
}

const handleChatModelSelect = async (
  model: RENDERER_MODEL_META,
  providerId: string
): Promise<void> => {
  selectedChatModel.value = { providerId, model }
  await configPresenter.setSetting('defaultModel', { providerId, modelId: model.id })
  chatModelSelectOpen.value = false
}

const handleVisionModelSelect = async (
  model: RENDERER_MODEL_META,
  providerId: string
): Promise<void> => {
  selectedVisionModel.value = { providerId, model }
  await configPresenter.setSetting('defaultVisionModel', { providerId, modelId: model.id })
  visionModelSelectOpen.value = false
}

const syncModelSelections = async (): Promise<void> => {
  if (isSyncingModelDefaults) {
    return
  }
  isSyncingModelDefaults = true
  try {
    const assistantModelSetting = (await configPresenter.getSetting('assistantModel')) as
      | { providerId: string; modelId: string }
      | undefined
    const defaultModelSetting = (await configPresenter.getSetting('defaultModel')) as
      | { providerId: string; modelId: string }
      | undefined
    const defaultVisionModelSetting = (await configPresenter.getSetting('defaultVisionModel')) as
      | { providerId: string; modelId: string }
      | undefined

    const chatSelection = selectBySetting(
      defaultModelSetting,
      (_model, providerId) => providerId !== 'acp'
    )

    const assistantSelection = selectBySetting(
      assistantModelSetting,
      (_model, providerId) => providerId !== 'acp'
    )

    const visionSelection = selectBySetting(
      defaultVisionModelSetting,
      (model, providerId) =>
        providerId !== 'acp' &&
        Boolean(model.vision) &&
        (model.type === ModelType.Chat || model.type === ModelType.ImageGeneration)
    )

    selectedChatModel.value = chatSelection
    selectedAssistantModel.value = assistantSelection
    selectedVisionModel.value = visionSelection

    await persistModelSetting('defaultModel', defaultModelSetting, chatSelection)
    await persistModelSetting('assistantModel', assistantModelSetting, assistantSelection)
    await persistModelSetting('defaultVisionModel', defaultVisionModelSetting, visionSelection)
  } catch (error) {
    console.error('Failed to sync model selections:', error)
  } finally {
    isSyncingModelDefaults = false
  }
}

onMounted(() => {
  syncModelSelections()
})

watch(
  () => modelStore.enabledModels,
  () => {
    void syncModelSelections()
  },
  { deep: true }
)
</script>
