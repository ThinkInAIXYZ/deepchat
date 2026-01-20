import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAcpRuntimeAdapter } from '@/composables/chat/useAcpRuntimeAdapter'
import { useAcpEventsAdapter } from '@/composables/acp/useAcpEventsAdapter'
import type { Ref } from 'vue'

type ActiveModelRef = Ref<{ id?: string; providerId?: string } | null>

interface UseAcpSessionModelOptions {
  activeModel: ActiveModelRef
  conversationId: Ref<string | null>
  /** Streaming state - used to detect when session has been created */
  isStreaming?: Ref<boolean>
  workdir?: Ref<string | null>
}

interface ModelInfo {
  id: string
  name: string
  description?: string
}

export function useAcpSessionModel(options: UseAcpSessionModelOptions) {
  const acpRuntimeAdapter = useAcpRuntimeAdapter()
  const acpEventsAdapter = useAcpEventsAdapter()
  let unsubscribeSessionModels: (() => void) | null = null

  const currentModelId = ref<string>('')
  const availableModels = ref<ModelInfo[]>([])
  const loading = ref(false)
  const lastWarmupModelsKey = ref<string | null>(null)
  const pendingPreferredModel = ref<string | null>(null)

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )
  const agentId = computed(() => options.activeModel.value?.id ?? '')

  const hasConversation = computed(() => Boolean(options.conversationId.value))
  const selectedWorkdir = computed(() => options.workdir?.value ?? null)

  const hasModels = computed(() => availableModels.value.length > 0)

  const loadModels = async () => {
    if (!isAcpModel.value || !hasConversation.value || !options.conversationId.value) {
      currentModelId.value = ''
      availableModels.value = []
      return
    }

    loading.value = true
    try {
      const result = await acpRuntimeAdapter.getAcpSessionModels(options.conversationId.value)
      if (result && result.available.length > 0) {
        currentModelId.value = result.current
        availableModels.value = result.available
        console.info(
          `[useAcpSessionModel] Loaded models: current="${result.current}", available=[${result.available.map((m) => m.id).join(', ')}]`
        )
      } else {
        currentModelId.value = ''
        availableModels.value = []
      }
    } catch (error) {
      console.warn('[useAcpSessionModel] Failed to load models', error)
    } finally {
      loading.value = false
    }
  }

  const loadWarmupModels = async () => {
    if (!isAcpModel.value || hasConversation.value) return
    const workdir = selectedWorkdir.value
    if (!agentId.value || !workdir) return
    if (availableModels.value.length > 0) return

    const warmupKey = `${agentId.value}::${workdir}`
    if (lastWarmupModelsKey.value === warmupKey) return
    lastWarmupModelsKey.value = warmupKey

    try {
      const result = await acpRuntimeAdapter.getAcpProcessModels(agentId.value, workdir)
      if (result?.availableModels && result.availableModels.length > 0) {
        currentModelId.value =
          result.currentModelId ?? result.availableModels[0]?.id ?? currentModelId.value
        availableModels.value = result.availableModels
        console.info(
          `[useAcpSessionModel] Loaded warmup models: current="${currentModelId.value}", available=[${result.availableModels.map((m) => m.id).join(', ')}]`
        )
      }
    } catch (error) {
      console.warn('[useAcpSessionModel] Failed to load warmup models', error)
    }
  }

  watch(
    [isAcpModel, options.conversationId, agentId],
    () => {
      void loadModels()
    },
    { immediate: true }
  )

  watch(
    [isAcpModel, selectedWorkdir, options.conversationId, agentId],
    () => {
      if (!hasConversation.value) {
        void loadWarmupModels()
      }
    },
    { immediate: true }
  )

  if (options.isStreaming) {
    watch(options.isStreaming, (newVal, oldVal) => {
      if (oldVal === true && newVal === false && !hasModels.value) {
        console.info('[useAcpSessionModel] Streaming ended, reloading models...')
        void loadModels()
      }
    })
  }

  watch(agentId, (newId, oldId) => {
    if (!newId || newId === oldId) return
    currentModelId.value = ''
    availableModels.value = []
    pendingPreferredModel.value = null
    lastWarmupModelsKey.value = null
  })

  const handleModelsReady = (payload: {
    conversationId?: string
    agentId?: string
    workdir?: string
    current: string
    available: ModelInfo[]
  }) => {
    if (!isAcpModel.value) return

    const conversationMatch =
      payload.conversationId && payload.conversationId === options.conversationId.value
    const agentMatch = payload.agentId && payload.agentId === options.activeModel.value?.id
    const workdirMatch =
      !selectedWorkdir.value || !payload.workdir || selectedWorkdir.value === payload.workdir

    if (conversationMatch || (agentMatch && workdirMatch)) {
      console.info(
        `[useAcpSessionModel] Received models from main: current="${payload.current}", available=[${payload.available.map((m) => m.id).join(', ')}]`
      )
      currentModelId.value = payload.current
      availableModels.value = payload.available
      if (!conversationMatch && pendingPreferredModel.value) {
        currentModelId.value = pendingPreferredModel.value
      }
    }
  }

  onMounted(() => {
    unsubscribeSessionModels = acpEventsAdapter.subscribeSessionModelsReady(handleModelsReady)
  })

  onUnmounted(() => {
    unsubscribeSessionModels?.()
    unsubscribeSessionModels = null
  })

  const setModel = async (modelId: string) => {
    if (loading.value || !isAcpModel.value || !modelId) {
      return
    }
    if (modelId === currentModelId.value) {
      return
    }

    loading.value = true
    try {
      if (options.conversationId.value) {
        await acpRuntimeAdapter.setAcpSessionModel(options.conversationId.value, modelId)
        currentModelId.value = modelId
        pendingPreferredModel.value = null
      } else if (selectedWorkdir.value) {
        await acpRuntimeAdapter.setAcpPreferredProcessModel(
          options.activeModel.value!.id!,
          selectedWorkdir.value,
          modelId
        )
        currentModelId.value = modelId
        pendingPreferredModel.value = modelId
      }
    } catch (error) {
      console.error('[useAcpSessionModel] Failed to set model', error)
    } finally {
      loading.value = false
    }
  }

  const currentModelInfo = computed(() => {
    return availableModels.value.find((m) => m.id === currentModelId.value)
  })

  const currentModelName = computed(() => {
    const modelInfo = currentModelInfo.value
    return modelInfo?.name || currentModelId.value
  })

  return {
    isAcpModel,
    currentModelId,
    currentModelName,
    currentModelInfo,
    availableModels,
    hasModels,
    setModel,
    loading
  }
}
