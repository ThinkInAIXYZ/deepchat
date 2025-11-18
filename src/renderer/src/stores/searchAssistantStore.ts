import { ref, computed, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'

export const useSearchAssistantStore = defineStore('searchAssistant', () => {
  const configP = usePresenter('configPresenter')
  const threadP = usePresenter('threadPresenter')

  const modelRef = ref<RENDERER_MODEL_META | null>(null)
  const providerRef = ref<string>('')
  const priorities = [
    'gpt-3.5',
    'Qwen2.5-32B',
    'Qwen2.5-14B',
    'Qwen2.5-7B',
    '14B',
    '7B',
    '32B',
    'deepseek-chat'
  ]

  const searchAssistantModel = computed(() => modelRef.value)
  const searchAssistantProvider = computed(() => providerRef.value)

  const findPriorityModel = (
    enabled: { providerId: string; models: RENDERER_MODEL_META[] }[]
  ): { model: RENDERER_MODEL_META; providerId: string } | null => {
    if (!enabled || enabled.length === 0) {
      return null
    }

    for (const keyword of priorities) {
      for (const providerModels of enabled) {
        for (const model of providerModels.models) {
          if (
            model.id.toLowerCase().includes(keyword.toLowerCase()) ||
            model.name.toLowerCase().includes(keyword.toLowerCase())
          ) {
            return {
              model,
              providerId: providerModels.providerId
            }
          }
        }
      }
    }

    const fallback = enabled
      .flatMap((provider) =>
        provider.models.map((model) => ({ ...model, providerId: provider.providerId }))
      )
      .find((model) => model.type === ModelType.Chat || model.type === ModelType.ImageGeneration)

    if (fallback) {
      return {
        model: fallback,
        providerId: fallback.providerId
      }
    }

    return null
  }

  const setSearchAssistantModel = async (model: RENDERER_MODEL_META, providerId: string) => {
    const rawModel = toRaw(model)
    modelRef.value = rawModel
    providerRef.value = providerId

    await configP.setSetting('searchAssistantModel', {
      model: rawModel,
      providerId
    })

    threadP.setSearchAssistantModel(rawModel, providerId)
  }

  const initOrUpdateSearchAssistantModel = async (
    enabled: { providerId: string; models: RENDERER_MODEL_META[] }[]
  ) => {
    let savedModel = await configP.getSetting<{ model: RENDERER_MODEL_META; providerId: string }>(
      'searchAssistantModel'
    )
    savedModel = toRaw(savedModel)
    if (savedModel) {
      modelRef.value = savedModel.model
      providerRef.value = savedModel.providerId
      threadP.setSearchAssistantModel(savedModel.model, savedModel.providerId)
      return
    }

    const priorityEntry = findPriorityModel(enabled)
    if (priorityEntry) {
      await setSearchAssistantModel(
        {
          ...priorityEntry.model,
          providerId: priorityEntry.providerId,
          enabled: true,
          type: priorityEntry.model.type || ModelType.Chat,
          vision: priorityEntry.model.vision || false,
          functionCall: priorityEntry.model.functionCall || false,
          reasoning: priorityEntry.model.reasoning || false
        },
        priorityEntry.providerId
      )
    }
  }

  const checkAndUpdateSearchAssistantModel = async (
    enabled: { providerId: string; models: RENDERER_MODEL_META[] }[]
  ) => {
    const currentModel = modelRef.value
    if (!currentModel) {
      await initOrUpdateSearchAssistantModel(enabled)
      return
    }

    const stillAvailable = enabled.some((provider) =>
      provider.models.some((model) => model.id === currentModel.id)
    )

    if (!stillAvailable) {
      await initOrUpdateSearchAssistantModel(enabled)
    }
  }

  return {
    searchAssistantModel,
    searchAssistantProvider,
    setSearchAssistantModel,
    initOrUpdateSearchAssistantModel,
    checkAndUpdateSearchAssistantModel,
    priorities
  }
})
