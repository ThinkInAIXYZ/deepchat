import { defineStore } from 'pinia'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { MCP_EVENTS } from '@/events'
import type {
  McpSamplingDecision,
  McpSamplingRequestPayload,
  RENDERER_MODEL_META
} from '@shared/presenter'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

export const useMcpSamplingStore = defineStore('mcpSampling', () => {
  const mcpPresenter = usePresenter('mcpPresenter')
  const chatStore = useChatStore()
  const settingsStore = useSettingsStore()

  const request = ref<McpSamplingRequestPayload | null>(null)
  const isOpen = ref(false)
  const isSubmitting = ref(false)
  const isChoosingModel = ref(false)
  const selectedProviderId = ref<string | null>(null)
  const selectedModel = ref<RENDERER_MODEL_META | null>(null)

  const requiresVision = computed(() => request.value?.requiresVision ?? false)
  const selectedModelSupportsVision = computed(() => selectedModel.value?.vision ?? false)
  const selectedProviderLabel = computed(() => {
    if (!selectedProviderId.value) {
      return null
    }

    const provider = settingsStore.sortedProviders.find(
      (entry) => entry.id === selectedProviderId.value
    )

    return provider?.name ?? selectedProviderId.value
  })

  const resetSelection = () => {
    const requiresVisionValue = requiresVision.value

    const pickEligibleModel = (
      providerEntry: { providerId: string; models: RENDERER_MODEL_META[] } | undefined,
      preferredModelId?: string | null
    ): { providerId: string | null; model: RENDERER_MODEL_META | null } => {
      if (!providerEntry) {
        return { providerId: null, model: null }
      }

      const models = requiresVisionValue
        ? providerEntry.models.filter((model) => model.vision)
        : providerEntry.models

      if (models.length === 0) {
        return { providerId: null, model: null }
      }

      if (preferredModelId) {
        const preferredModel = models.find((model) => model.id === preferredModelId)
        if (preferredModel) {
          return { providerId: providerEntry.providerId, model: preferredModel }
        }
      }

      return { providerId: providerEntry.providerId, model: models[0] }
    }

    const activeProviderId = chatStore.chatConfig.providerId || null
    const activeModelId = chatStore.chatConfig.modelId || null

    if (activeProviderId) {
      const providerEntry = settingsStore.enabledModels.find(
        (entry) => entry.providerId === activeProviderId
      )
      const selection = pickEligibleModel(providerEntry, activeModelId)
      if (selection.model && selection.providerId) {
        selectedProviderId.value = selection.providerId
        selectedModel.value = selection.model
        return
      }
    }

    for (const provider of settingsStore.sortedProviders) {
      if (!provider.enable) {
        continue
      }

      const providerEntry = settingsStore.enabledModels.find(
        (entry) => entry.providerId === provider.id
      )

      const selection = pickEligibleModel(providerEntry)
      if (selection.model && selection.providerId) {
        selectedProviderId.value = selection.providerId
        selectedModel.value = selection.model
        return
      }
    }

    selectedProviderId.value = null
    selectedModel.value = null
  }

  const hasEligibleModel = computed(() => {
    if (!request.value) {
      return false
    }

    const requiresVisionValue = requiresVision.value
    return settingsStore.enabledModels.some((entry) =>
      entry.models.some((model) => !requiresVisionValue || model.vision)
    )
  })

  const openRequest = (payload: McpSamplingRequestPayload) => {
    request.value = payload
    isOpen.value = true
    isChoosingModel.value = false
    isSubmitting.value = false
    resetSelection()
  }

  const clearRequest = () => {
    isOpen.value = false
    isChoosingModel.value = false
    isSubmitting.value = false
    request.value = null
    selectedProviderId.value = null
    selectedModel.value = null
  }

  const beginApprove = () => {
    isChoosingModel.value = true
  }

  const selectModel = (model: RENDERER_MODEL_META, providerId: string) => {
    if (requiresVision.value && !model.vision) {
      return
    }

    selectedModel.value = model
    selectedProviderId.value = providerId
  }

  const submitDecision = async (decision: McpSamplingDecision) => {
    if (!request.value) {
      return
    }

    isSubmitting.value = true
    try {
      await mcpPresenter.submitSamplingDecision(decision)
      clearRequest()
    } catch (error) {
      console.error('[MCP Sampling] Failed to submit decision:', error)
      isSubmitting.value = false
    }
  }

  const confirmApproval = async () => {
    if (!request.value || !selectedProviderId.value || !selectedModel.value) {
      return
    }

    await submitDecision({
      requestId: request.value.requestId,
      approved: true,
      providerId: selectedProviderId.value,
      modelId: selectedModel.value.id
    })
  }

  const rejectRequest = async () => {
    if (!request.value) {
      return
    }

    await submitDecision({
      requestId: request.value.requestId,
      approved: false,
      reason: 'User rejected sampling request'
    })
  }

  const dismiss = async () => {
    if (!request.value) {
      clearRequest()
      return
    }

    await submitDecision({
      requestId: request.value.requestId,
      approved: false,
      reason: 'User dismissed sampling request'
    })
  }

  const handleSamplingRequest = (_event: unknown, payload: McpSamplingRequestPayload) => {
    openRequest(payload)
  }

  const handleSamplingCancelled = (_event: unknown, payload: { requestId: string }) => {
    if (request.value && payload.requestId === request.value.requestId) {
      clearRequest()
    }
  }

  const handleSamplingDecision = (_event: unknown, payload: McpSamplingDecision) => {
    if (request.value && payload.requestId === request.value.requestId) {
      clearRequest()
    }
  }

  onMounted(() => {
    window.electron.ipcRenderer.on(MCP_EVENTS.SAMPLING_REQUEST, handleSamplingRequest)
    window.electron.ipcRenderer.on(MCP_EVENTS.SAMPLING_CANCELLED, handleSamplingCancelled)
    window.electron.ipcRenderer.on(MCP_EVENTS.SAMPLING_DECISION, handleSamplingDecision)
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.removeListener(MCP_EVENTS.SAMPLING_REQUEST, handleSamplingRequest)
    window.electron.ipcRenderer.removeListener(
      MCP_EVENTS.SAMPLING_CANCELLED,
      handleSamplingCancelled
    )
    window.electron.ipcRenderer.removeListener(MCP_EVENTS.SAMPLING_DECISION, handleSamplingDecision)
  })

  return {
    request,
    isOpen,
    isSubmitting,
    isChoosingModel,
    requiresVision,
    selectedModelSupportsVision,
    selectedProviderLabel,
    selectedProviderId,
    selectedModel,
    hasEligibleModel,
    beginApprove,
    selectModel,
    confirmApproval,
    rejectRequest,
    dismiss
  }
})
