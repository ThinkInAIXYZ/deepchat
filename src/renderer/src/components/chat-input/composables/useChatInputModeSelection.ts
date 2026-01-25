import { computed, type Ref } from 'vue'
import { ModelType } from '@shared/model'
import type { ChatMode } from './useChatMode'

type ActiveModel = { id?: string; providerId?: string } | null

type ModeSelectionOptions = {
  variant: 'agent' | 'newThread' | 'acp'
  activeModel: Ref<ActiveModel>
  conversationId: Ref<string | null>
  chatMode: {
    currentMode: Ref<ChatMode>
    setMode: (mode: ChatMode) => Promise<void>
  }
  modelStore: {
    enabledModels: Array<{
      providerId: string
      models: Array<{
        id: string
        name: string
        type?: ModelType
      }>
    }>
  }
  config: {
    handleModelUpdate: (payload: unknown) => void
  }
  acpMode: {
    isAcpModel: Ref<boolean>
    hasAgentModes: Ref<boolean>
    availableModes: Ref<unknown[]>
    currentMode: Ref<string>
    currentModeName: Ref<string>
    currentModeInfo: Ref<unknown | null>
    loading: Ref<boolean>
    setMode: (modeId: string) => Promise<void>
  }
  acpSessionModel: {
    isAcpModel: Ref<boolean>
    hasModels: Ref<boolean>
    availableModels: Ref<unknown[]>
    currentModelId: Ref<string>
    currentModelName: Ref<string>
    loading: Ref<boolean>
    setModel: (modelId: string) => Promise<void>
  }
  updateChatConfig: (payload: { chatMode: ChatMode }) => Promise<void>
  emitModelUpdate: (payload: unknown, providerId: string) => void
}

export function useChatInputModeSelection(options: ModeSelectionOptions) {
  // ACP agent options are no longer used after ACP cleanup
  const acpAgentOptions = computed(
    () =>
      [] as Array<{
        id: string
        name: string
        providerId: string
        type: ModelType
      }>
  )

  const selectedAcpAgentId = computed(() => null as string | null)

  // ACP chat mode is no longer available
  const showAcpSessionModelSelector = computed(() => false)

  const applyModelSelection = (model: {
    id: string
    name: string
    providerId: string
    type?: ModelType
  }) => {
    if (!model?.id || !model.providerId) return
    const payload = {
      id: model.id,
      name: model.name,
      providerId: model.providerId,
      type: model.type ?? ModelType.Chat
    }
    if (options.variant === 'agent' || options.variant === 'newThread') {
      options.config.handleModelUpdate(payload as unknown)
    } else {
      options.emitModelUpdate(payload as unknown, model.providerId)
    }
  }

  const pickFirstNonAcpModel = () => {
    for (const provider of options.modelStore.enabledModels) {
      if (provider.providerId === 'acp') continue
      const match = provider.models.find(
        (model) => model.type === ModelType.Chat || model.type === ModelType.ImageGeneration
      )
      if (match) {
        return {
          id: match.id,
          name: match.name,
          providerId: provider.providerId,
          type: match.type ?? ModelType.Chat
        }
      }
    }
    return null
  }

  const handleModeSelect = async (mode: ChatMode) => {
    await options.chatMode.setMode(mode)
    if (options.chatMode.currentMode.value !== mode) {
      return
    }

    // If current model is ACP, switch to a non-ACP model
    if (options.activeModel.value?.providerId === 'acp') {
      const fallback = pickFirstNonAcpModel()
      if (fallback) {
        applyModelSelection(fallback)
      }
    }

    if (options.conversationId.value) {
      try {
        await options.updateChatConfig({ chatMode: mode })
      } catch (error) {
        console.warn('Failed to update chat mode in conversation settings:', error)
      }
    }
  }

  // ACP agent selection is no longer available
  const handleAcpAgentSelect = async (_agent: {
    id: string
    name: string
    providerId: string
    type?: ModelType
  }) => {
    // No-op after ACP cleanup
  }

  const handleAcpModeSelect = async (modeId: string) => {
    if (options.acpMode.loading.value) return
    await options.acpMode.setMode(modeId)
  }

  const handleAcpSessionModelSelect = async (modelId: string) => {
    if (options.acpSessionModel.loading.value) return
    await options.acpSessionModel.setModel(modelId)
  }

  return {
    acpAgentOptions,
    selectedAcpAgentId,
    showAcpSessionModelSelector,
    handleModeSelect,
    handleAcpAgentSelect,
    handleAcpModeSelect,
    handleAcpSessionModelSelect
  }
}
