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
  const acpAgentOptions = computed(() => {
    const providerEntry = options.modelStore.enabledModels.find(
      (entry) => entry.providerId === 'acp'
    )
    const models = providerEntry?.models ?? []
    return models
      .filter((model) => model.type === ModelType.Chat || model.type === ModelType.ImageGeneration)
      .map((model) => ({
        id: model.id,
        name: model.name,
        providerId: 'acp',
        type: model.type ?? ModelType.Chat
      }))
  })

  const selectedAcpAgentId = computed(() => {
    const active = options.activeModel.value
    return active?.providerId === 'acp' ? (active.id ?? null) : null
  })

  const isAcpChatMode = computed(() => options.chatMode.currentMode.value === 'acp agent')
  const showAcpSessionModelSelector = computed(
    () => isAcpChatMode.value && options.acpSessionModel.isAcpModel.value
  )

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

  const pickFirstAcpModel = () => acpAgentOptions.value[0] ?? null

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

    if (mode !== 'acp agent' && options.activeModel.value?.providerId === 'acp') {
      const fallback = pickFirstNonAcpModel()
      if (fallback) {
        applyModelSelection(fallback)
      }
    } else if (mode === 'acp agent' && options.activeModel.value?.providerId !== 'acp') {
      const fallback = pickFirstAcpModel()
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

  const handleAcpAgentSelect = async (agent: {
    id: string
    name: string
    providerId: string
    type?: ModelType
  }) => {
    await options.chatMode.setMode('acp agent')
    if (options.chatMode.currentMode.value !== 'acp agent') {
      return
    }
    applyModelSelection(agent)
    if (options.conversationId.value) {
      try {
        await options.updateChatConfig({ chatMode: 'acp agent' })
      } catch (error) {
        console.warn('Failed to update chat mode in conversation settings:', error)
      }
    }
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
