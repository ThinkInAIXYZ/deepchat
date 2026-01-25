import { computed, type Ref } from 'vue'
import { ModelType } from '@shared/model'

type ActiveModel = { id?: string; providerId?: string } | null

type ModeSelectionOptions = {
  variant: 'agent' | 'newThread' | 'acp'
  activeModel: Ref<ActiveModel>
  conversationId: Ref<string | null>
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
  updateChatConfig: (payload: unknown) => Promise<void>
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
    handleAcpAgentSelect,
    handleAcpModeSelect,
    handleAcpSessionModelSelect
  }
}
