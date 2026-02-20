import { ref, computed, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/modelStore'
import { useAgentStore } from '@/stores/agent'
import { useProviderStore } from '@/stores/providerStore'
import { usePresenter } from '@/composables/usePresenter'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import type { AcpAgent } from '@shared/types/presenters/agentConfig.presenter'
import { usePromptInputConfig } from '@/components/chat-input/composables/usePromptInputConfig'

type EffortLevel = 'minimal' | 'low' | 'medium' | 'high'
type VerbosityLevel = 'low' | 'medium' | 'high'
type ModelSetting = {
  providerId: string
  modelId: string
}

export function useNewThreadStatusBar() {
  const chatStore = useChatStore()
  const modelStore = useModelStore()
  const agentStore = useAgentStore()
  const providerStore = useProviderStore()
  const configPresenter = usePresenter('configPresenter')
  const promptConfig = usePromptInputConfig()

  // Local state for permissions only. Model config states are bound to chat config.
  const selectedPermission = ref<'default' | 'restricted' | 'full'>('default')

  // Get current agent from sidebar
  const currentAgent = computed(() => agentStore.selectedAgent)

  // Check if current agent is ACP type
  const isAcpAgent = computed(() => {
    return currentAgent.value?.type === 'acp'
  })

  // Get ACP agent info
  const acpAgentInfo = computed(() => {
    if (!isAcpAgent.value || !currentAgent.value) return null
    return currentAgent.value as AcpAgent
  })

  // Get all enabled models from modelStore
  const enabledModels = computed(() => {
    const models: RENDERER_MODEL_META[] = []
    for (const group of modelStore.enabledModels) {
      models.push(...group.models)
    }
    return models
  })

  const selectableModels = computed(() =>
    enabledModels.value.filter((model) => model.providerId && model.providerId !== 'acp')
  )

  const expectedModelProviderIds = computed(() =>
    providerStore.providers
      .filter((provider) => provider.enable && provider.id !== 'acp')
      .map((provider) => provider.id)
  )

  const loadedModelProviderIds = computed(
    () =>
      new Set(
        modelStore.allProviderModels
          .filter((providerGroup) => providerGroup.providerId !== 'acp')
          .map((providerGroup) => providerGroup.providerId)
      )
  )

  const modelCatalogReady = computed(() => {
    const expectedIds = expectedModelProviderIds.value
    if (expectedIds.length === 0) return false
    return expectedIds.every((providerId) => loadedModelProviderIds.value.has(providerId))
  })

  const findEnabledModel = (providerId?: string, modelId?: string) => {
    if (!providerId || !modelId) return null
    return (
      selectableModels.value.find(
        (model) => model.providerId === providerId && model.id === modelId
      ) ?? null
    )
  }

  // Get current active model from chat config
  const activeModel = computed(() => {
    const modelId = chatStore.chatConfig.modelId
    const providerId = chatStore.chatConfig.providerId

    if (!modelId || !providerId) {
      return {
        name: '',
        id: modelId || '',
        providerId: providerId || ''
      }
    }

    // Find in enabled models
    for (const group of modelStore.enabledModels) {
      if (group.providerId !== providerId) continue
      const found = group.models.find((m) => m.id === modelId)
      if (found) {
        return {
          name: found.name,
          id: found.id,
          providerId: group.providerId
        }
      }
    }

    return {
      name: modelId,
      id: modelId,
      providerId
    }
  })

  // Get model display name (shortened)
  const modelDisplayName = computed(() => {
    return activeModel.value.name?.split('/').pop() ?? activeModel.value.name
  })

  const normalizeModelSetting = (raw: unknown): ModelSetting | null => {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Partial<ModelSetting>
    if (!value.providerId || !value.modelId) return null
    if (typeof value.providerId !== 'string' || typeof value.modelId !== 'string') return null
    return {
      providerId: value.providerId,
      modelId: value.modelId
    }
  }

  const readModelSetting = async (key: 'preferredModel' | 'defaultModel') => {
    const setting = await configPresenter.getSetting(key)
    return normalizeModelSetting(setting)
  }

  const resolveFallbackModel = async (): Promise<{
    fallbackModel: RENDERER_MODEL_META | null
    hasConfiguredDefault: boolean
  }> => {
    const preferredModel = await readModelSetting('preferredModel')
    const defaultModel = await readModelSetting('defaultModel')
    const hasConfiguredDefault = Boolean(preferredModel || defaultModel)

    const preferredMatch = findEnabledModel(preferredModel?.providerId, preferredModel?.modelId)
    if (preferredMatch) {
      return {
        fallbackModel: preferredMatch,
        hasConfiguredDefault
      }
    }

    const defaultMatch = findEnabledModel(defaultModel?.providerId, defaultModel?.modelId)
    if (defaultMatch) {
      return {
        fallbackModel: defaultMatch,
        hasConfiguredDefault
      }
    }

    return {
      fallbackModel: selectableModels.value[0] ?? null,
      hasConfiguredDefault
    }
  }

  const applyModelSelection = async (
    model: RENDERER_MODEL_META,
    options: { persistPreferred: boolean }
  ) => {
    const modelChanged =
      chatStore.chatConfig.modelId !== model.id ||
      chatStore.chatConfig.providerId !== model.providerId

    if (modelChanged) {
      await chatStore.updateChatConfig({
        modelId: model.id,
        providerId: model.providerId
      })
    }

    await promptConfig.loadModelConfig()

    if (options.persistPreferred) {
      await configPresenter.setSetting('preferredModel', {
        modelId: model.id,
        providerId: model.providerId
      })
    }
  }

  const ensureValidModelSelection = async () => {
    if (isAcpAgent.value) return
    if (selectableModels.value.length === 0) return

    const currentModel = findEnabledModel(
      chatStore.chatConfig.providerId,
      chatStore.chatConfig.modelId
    )
    if (currentModel) return

    const { fallbackModel, hasConfiguredDefault } = await resolveFallbackModel()
    if (hasConfiguredDefault && !modelCatalogReady.value) {
      // Wait until provider/model catalog settles to avoid picking a wrong early fallback.
      return
    }
    if (!fallbackModel) return
    await applyModelSelection(fallbackModel, { persistPreferred: false })
  }

  let isEnsuringModel = false
  let shouldRerunEnsure = false
  const runEnsureValidModelSelection = async () => {
    if (isEnsuringModel) {
      shouldRerunEnsure = true
      return
    }
    isEnsuringModel = true
    try {
      await ensureValidModelSelection()
    } finally {
      isEnsuringModel = false
      if (shouldRerunEnsure) {
        shouldRerunEnsure = false
        await runEnsureValidModelSelection()
      }
    }
  }

  watch(
    [
      isAcpAgent,
      () => selectableModels.value.map((model) => `${model.providerId}:${model.id}`).join('|'),
      () => modelCatalogReady.value,
      () => expectedModelProviderIds.value.join('|'),
      () => Array.from(loadedModelProviderIds.value).sort().join('|'),
      () => chatStore.chatConfig.providerId,
      () => chatStore.chatConfig.modelId
    ],
    () => {
      void runEnsureValidModelSelection()
    },
    { immediate: true }
  )

  // Handle model selection
  const selectModel = async (model: RENDERER_MODEL_META) => {
    await applyModelSelection(model, {
      persistPreferred: true
    })
  }

  const selectedEffort = computed<EffortLevel>(
    () => promptConfig.configReasoningEffort.value ?? 'medium'
  )
  const selectedVerbosity = computed(() => promptConfig.configVerbosity.value)
  const showVerbosity = computed(() => selectedVerbosity.value !== undefined)

  const effortOptions = computed<EffortLevel[]>(() => {
    if (chatStore.chatConfig.providerId === 'grok') return ['low', 'high']
    return ['minimal', 'low', 'medium', 'high']
  })

  // Handle effort selection (bound to chat config)
  const selectEffort = async (effort: EffortLevel) => {
    promptConfig.configReasoningEffort.value = effort
    await chatStore.updateChatConfig({ reasoningEffort: effort })
  }

  const selectVerbosity = async (verbosity: VerbosityLevel) => {
    promptConfig.configVerbosity.value = verbosity
    await chatStore.updateChatConfig({ verbosity })
  }

  // Handle permission selection
  const selectPermission = (permission: 'default' | 'restricted' | 'full') => {
    selectedPermission.value = permission
  }

  const verbosityOptions = computed<VerbosityLevel[]>(() => ['low', 'medium', 'high'])

  return {
    // Agent
    currentAgent,
    isAcpAgent,
    acpAgentInfo,

    // Model
    enabledModels,
    activeModel,
    modelDisplayName,
    selectModel,

    // Effort
    selectedEffort,
    effortOptions,
    selectEffort,
    selectedVerbosity,
    showVerbosity,
    verbosityOptions,
    selectVerbosity,

    // Permissions
    selectedPermission,
    selectPermission,

    // ChatConfig bindings
    configSystemPrompt: promptConfig.configSystemPrompt,
    configTemperature: promptConfig.configTemperature,
    configContextLength: promptConfig.configContextLength,
    configMaxTokens: promptConfig.configMaxTokens,
    configArtifacts: promptConfig.configArtifacts,
    configThinkingBudget: promptConfig.configThinkingBudget,
    configReasoningEffort: promptConfig.configReasoningEffort,
    configVerbosity: promptConfig.configVerbosity,
    configContextLengthLimit: promptConfig.configContextLengthLimit,
    configMaxTokensLimit: promptConfig.configMaxTokensLimit,
    configModelType: promptConfig.configModelType
  }
}
