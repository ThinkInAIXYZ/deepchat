import { defineStore } from 'pinia'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { createMcpClient } from '@api/McpClient'
import type {
  McpSamplingDecision,
  McpSamplingRequestPayload,
  RENDERER_MODEL_META
} from '@shared/presenter'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'
import { useSessionStore } from '@/stores/ui/session'
import { useDraftStore } from '@/stores/ui/draft'

interface ApprovedServerInfo {
  providerId: string
  modelId: string
  timestamp: number
}

// Session timeout: 30 minutes
const SESSION_TIMEOUT = 30 * 60 * 1000

type ModelSelection = {
  providerId: string
  modelId?: string | null
}

const pickEligibleModel = (
  providerEntry: { providerId: string; models: RENDERER_MODEL_META[] } | undefined,
  requiresVision: boolean,
  preferredModelId?: string | null
): { providerId: string | null; model: RENDERER_MODEL_META | null } => {
  if (!providerEntry) {
    return { providerId: null, model: null }
  }

  const models = requiresVision
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

export const resolveSamplingDefaultModel = (input: {
  modelGroups: Array<{ providerId: string; models: RENDERER_MODEL_META[] }>
  requiresVision: boolean
  activeSelection?: ModelSelection | null
  draftSelection?: ModelSelection | null
}): { providerId: string | null; model: RENDERER_MODEL_META | null } => {
  const selectFrom = (selection?: ModelSelection | null) => {
    if (!selection?.providerId) {
      return { providerId: null, model: null as RENDERER_MODEL_META | null }
    }
    const providerEntry = input.modelGroups.find(
      (entry) => entry.providerId === selection.providerId
    )
    return pickEligibleModel(providerEntry, input.requiresVision, selection.modelId)
  }

  const activeMatch = selectFrom(input.activeSelection)
  if (activeMatch.providerId && activeMatch.model) {
    return activeMatch
  }

  const draftMatch = selectFrom(input.draftSelection)
  if (draftMatch.providerId && draftMatch.model) {
    return draftMatch
  }

  for (const providerEntry of input.modelGroups) {
    const match = pickEligibleModel(providerEntry, input.requiresVision)
    if (match.providerId && match.model) {
      return match
    }
  }

  return { providerId: null, model: null }
}

export const useMcpSamplingStore = defineStore('mcpSampling', () => {
  const mcpClient = createMcpClient()
  const modelStore = useModelStore()
  const providerStore = useProviderStore()
  const sessionStore = useSessionStore()
  const draftStore = useDraftStore()

  const request = ref<McpSamplingRequestPayload | null>(null)
  const isOpen = ref(false)
  const isSubmitting = ref(false)
  const selectedProviderId = ref<string | null>(null)
  const selectedModel = ref<RENDERER_MODEL_META | null>(null)
  const isPreparingModels = ref(false)
  const modelPreparationError = ref<Error | null>(null)
  const eventCleanups: Array<() => void> = []

  // Session tracking for auto-approval
  const approvedServers = ref<Map<string, ApprovedServerInfo>>(new Map())

  const requiresVision = computed(() => request.value?.requiresVision ?? false)
  const selectedModelSupportsVision = computed(() => selectedModel.value?.vision ?? false)
  const selectedProviderLabel = computed(() => {
    if (!selectedProviderId.value) {
      return null
    }

    const provider = providerStore.sortedProviders.find(
      (entry) => entry.id === selectedProviderId.value
    )

    return provider?.name ?? selectedProviderId.value
  })

  const isModelSelectionReady = computed(
    () => modelStore.initialized && !isPreparingModels.value && !modelPreparationError.value
  )

  const ensureModelsReady = async (): Promise<boolean> => {
    if (modelStore.initialized) {
      modelPreparationError.value = null
      isPreparingModels.value = false
      return true
    }

    isPreparingModels.value = true
    modelPreparationError.value = null

    try {
      await modelStore.initialize()
      return true
    } catch (error) {
      modelPreparationError.value =
        error instanceof Error ? error : new Error('Failed to initialize enabled models')
      return false
    } finally {
      isPreparingModels.value = false
    }
  }

  const resetSelection = () => {
    if (!modelStore.initialized) {
      selectedProviderId.value = null
      selectedModel.value = null
      return
    }

    const activeSession = sessionStore.activeSession
    const activeSelection =
      activeSession?.providerId && activeSession?.modelId
        ? { providerId: activeSession.providerId, modelId: activeSession.modelId }
        : null
    const draftSelection =
      draftStore.providerId && draftStore.modelId
        ? { providerId: draftStore.providerId, modelId: draftStore.modelId }
        : null

    const selection = resolveSamplingDefaultModel({
      modelGroups: modelStore.chatSelectableModelGroups,
      requiresVision: requiresVision.value,
      activeSelection,
      draftSelection
    })

    selectedProviderId.value = selection.providerId
    selectedModel.value = selection.model
  }

  const hasEligibleModel = computed(() => {
    if (!request.value || !isModelSelectionReady.value) {
      return false
    }

    const requiresVisionValue = requiresVision.value
    return modelStore.chatSelectableModelGroups.some((entry) =>
      entry.models.some((model) => !requiresVisionValue || model.vision)
    )
  })

  // Check if current server has an active session
  const isActiveSession = computed(() => {
    if (!request.value) return false

    const serverName = request.value.serverName
    const approvedInfo = approvedServers.value.get(serverName)

    if (!approvedInfo) return false

    // Check if session is still valid
    const now = Date.now()
    return now - approvedInfo.timestamp < SESSION_TIMEOUT
  })

  // Get active session info for current server
  const activeSessionInfo = computed(() => {
    if (!request.value) return null

    const serverName = request.value.serverName
    return approvedServers.value.get(serverName) || null
  })

  // Session management methods
  const cleanExpiredSessions = () => {
    const now = Date.now()
    for (const [serverName, info] of approvedServers.value.entries()) {
      if (now - info.timestamp >= SESSION_TIMEOUT) {
        approvedServers.value.delete(serverName)
      }
    }
  }

  const recordServerApproval = (serverName: string, providerId: string, modelId: string) => {
    approvedServers.value.set(serverName, {
      providerId,
      modelId,
      timestamp: Date.now()
    })
    cleanExpiredSessions()
  }

  const applySessionSelection = (): boolean => {
    if (!request.value || !modelStore.initialized) {
      return false
    }

    const sessionInfo = activeSessionInfo.value
    if (!sessionInfo) {
      return false
    }

    const match = modelStore.findChatSelectableModel(sessionInfo.providerId, sessionInfo.modelId)
    if (!match) {
      approvedServers.value.delete(request.value.serverName)
      return false
    }

    if (requiresVision.value && !match.model.vision) {
      approvedServers.value.delete(request.value.serverName)
      return false
    }

    selectedProviderId.value = match.providerId
    selectedModel.value = match.model
    return true
  }

  const autoApproveRequest = async (): Promise<boolean> => {
    if (!request.value) {
      return false
    }

    const applied = applySessionSelection()
    if (!applied || !selectedProviderId.value || !selectedModel.value) {
      return false
    }

    recordServerApproval(request.value.serverName, selectedProviderId.value, selectedModel.value.id)

    await submitDecision({
      requestId: request.value.requestId,
      approved: true,
      providerId: selectedProviderId.value,
      modelId: selectedModel.value.id
    })

    return true
  }

  const openRequest = (payload: McpSamplingRequestPayload) => {
    void (async () => {
      cleanExpiredSessions()
      request.value = payload
      isOpen.value = true
      isSubmitting.value = false
      selectedProviderId.value = null
      selectedModel.value = null

      const ready = await ensureModelsReady()
      if (!request.value || request.value.requestId !== payload.requestId) {
        return
      }

      if (!ready) {
        return
      }

      if (isActiveSession.value) {
        const success = await autoApproveRequest()
        if (!success && request.value?.requestId === payload.requestId) {
          resetSelection()
        }
        return
      }

      resetSelection()
    })()
  }

  const retryPrepareModels = async () => {
    cleanExpiredSessions()
    if (!request.value) {
      return
    }

    const currentRequestId = request.value.requestId
    const ready = await ensureModelsReady()
    if (!request.value || request.value.requestId !== currentRequestId || !ready) {
      return
    }

    if (isActiveSession.value) {
      const success = await autoApproveRequest()
      if (!success && request.value?.requestId === currentRequestId) {
        resetSelection()
      }
      return
    }

    resetSelection()
  }

  const clearRequest = () => {
    isOpen.value = false
    isSubmitting.value = false
    request.value = null
    selectedProviderId.value = null
    selectedModel.value = null
    isPreparingModels.value = false
    modelPreparationError.value = null
  }

  const selectModel = (model: RENDERER_MODEL_META, providerId: string) => {
    if (!isModelSelectionReady.value || (requiresVision.value && !model.vision)) {
      return
    }

    selectedModel.value = model
    selectedProviderId.value = providerId
  }

  const submitDecision = async (decision: McpSamplingDecision) => {
    if (!request.value) {
      return
    }

    const activeRequestId = request.value.requestId

    isSubmitting.value = true
    try {
      await mcpClient.submitSamplingDecision(decision)
      clearRequest()
    } catch (error) {
      console.error('[MCP Sampling] Failed to submit decision:', error)

      try {
        await mcpClient.cancelSamplingRequest(
          activeRequestId,
          'Sampling decision submission failed'
        )
      } catch (cancelError) {
        console.error('[MCP Sampling] Failed to cancel sampling request:', cancelError)
      }

      clearRequest()
    }
  }

  const confirmApproval = async () => {
    if (
      !request.value ||
      !selectedProviderId.value ||
      !selectedModel.value ||
      !isModelSelectionReady.value
    ) {
      return
    }

    // Record this server approval for future auto-approval
    recordServerApproval(request.value.serverName, selectedProviderId.value, selectedModel.value.id)

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

  const dismissRequest = async () => {
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

  const handleSamplingRequest = (payload: { request: unknown }) => {
    if (!payload?.request) {
      return
    }

    openRequest(payload.request as McpSamplingRequestPayload)
  }

  const handleSamplingCancelled = (payload: { requestId: string }) => {
    if (request.value && payload.requestId === request.value.requestId) {
      clearRequest()
    }
  }

  const handleSamplingDecision = (payload: { decision: unknown }) => {
    const decision = payload.decision as McpSamplingDecision | undefined
    if (request.value && decision?.requestId === request.value.requestId) {
      clearRequest()
    }
  }

  onMounted(() => {
    eventCleanups.push(mcpClient.onSamplingRequest(handleSamplingRequest))
    eventCleanups.push(mcpClient.onSamplingCancelled(handleSamplingCancelled))
    eventCleanups.push(mcpClient.onSamplingDecision(handleSamplingDecision))
  })

  onUnmounted(() => {
    while (eventCleanups.length > 0) {
      eventCleanups.pop()?.()
    }
  })

  return {
    request,
    isOpen,
    isSubmitting,
    requiresVision,
    selectedModelSupportsVision,
    selectedProviderLabel,
    selectedProviderId,
    selectedModel,
    isPreparingModels,
    modelPreparationError,
    isModelSelectionReady,
    hasEligibleModel,
    selectModel,
    confirmApproval,
    rejectRequest,
    dismissRequest,
    retryPrepareModels
  }
})
