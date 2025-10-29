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

  const resetSelection = () => {
    selectedProviderId.value = chatStore.chatConfig.providerId || null
    const providerId = selectedProviderId.value
    if (!providerId) {
      selectedModel.value = null
      return
    }

    const providerEntry = settingsStore.enabledModels.find(
      (entry) => entry.providerId === providerId
    )
    const activeModelId = chatStore.chatConfig.modelId
    const activeModel = providerEntry?.models.find((model) => model.id === activeModelId)

    if (activeModel) {
      selectedModel.value = activeModel
      return
    }

    selectedModel.value = providerEntry?.models?.[0] ?? null
  }

  const openRequest = (payload: McpSamplingRequestPayload) => {
    request.value = payload
    isOpen.value = true
    isChoosingModel.value = false
    isSubmitting.value = false
    resetSelection()
  }

  const closeRequest = () => {
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
      closeRequest()
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

  const handleSamplingRequest = (_event: unknown, payload: McpSamplingRequestPayload) => {
    openRequest(payload)
  }

  const handleSamplingCancelled = (_event: unknown, payload: { requestId: string }) => {
    if (request.value && payload.requestId === request.value.requestId) {
      closeRequest()
    }
  }

  const handleSamplingDecision = (_event: unknown, payload: McpSamplingDecision) => {
    if (request.value && payload.requestId === request.value.requestId) {
      closeRequest()
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
    selectedProviderId,
    selectedModel,
    beginApprove,
    selectModel,
    confirmApproval,
    rejectRequest,
    closeRequest
  }
})
