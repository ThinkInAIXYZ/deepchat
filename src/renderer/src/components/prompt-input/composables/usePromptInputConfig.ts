// === Vue Core ===
import { ref, computed, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'

// === Types ===
import { ModelType } from '@shared/model'
import type { MODEL_META, RENDERER_MODEL_META } from '@shared/presenter'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

/**
 * Composable for managing model configuration and synchronization with store
 * Handles bidirectional sync between local config refs and chatStore
 */
export function usePromptInputConfig() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')

  // === Stores ===
  const chatStore = useChatStore()
  const settingsStore = useSettingsStore()

  // === Local State ===
  const configTemperature = ref(chatStore.chatConfig.temperature)
  const configContextLength = ref(chatStore.chatConfig.contextLength)
  const configContextLengthLimit = ref(chatStore.chatConfig.contextLength)
  const configMaxTokens = ref(chatStore.chatConfig.maxTokens)
  const configMaxTokensLimit = ref(chatStore.chatConfig.maxTokens)
  const configSystemPrompt = ref(chatStore.chatConfig.systemPrompt)
  const configArtifacts = ref(chatStore.chatConfig.artifacts)
  const configThinkingBudget = ref(chatStore.chatConfig.thinkingBudget)
  const configEnableSearch = ref(chatStore.chatConfig.enableSearch)
  const configForcedSearch = ref(chatStore.chatConfig.forcedSearch)
  const configSearchStrategy = ref(chatStore.chatConfig.searchStrategy)
  const configReasoningEffort = ref(chatStore.chatConfig.reasoningEffort)
  const configVerbosity = ref(chatStore.chatConfig.verbosity)
  const configModelType = ref<ModelType>(ModelType.Chat)

  // === Computed ===
  const activeModel = computed(() => {
    const modelId = chatStore.chatConfig.modelId
    const providerId = chatStore.chatConfig.providerId

    if (!modelId || !providerId) {
      return {
        name: modelId || 'Unknown Model',
        id: modelId || '',
        providerId: providerId || '',
        tags: [] as string[]
      }
    }

    const allGroups = [...settingsStore.enabledModels, ...settingsStore.customModels]
    for (const group of allGroups) {
      if (group.providerId !== providerId) continue
      const found = group.models.find((item: RENDERER_MODEL_META) => item.id === modelId)
      if (found) {
        const tags = Array.isArray((found as any).tags) ? ((found as any).tags as string[]) : []
        return {
          name: found.name,
          id: found.id,
          providerId: group.providerId,
          tags
        }
      }
    }

    return {
      name: modelId || 'Unknown Model',
      id: modelId || '',
      providerId,
      tags: [] as string[]
    }
  })

  const modelDisplayName = computed(
    () => activeModel.value.name?.split('/').pop() ?? activeModel.value.name
  )

  // === Internal Helper Functions ===
  /**
   * Load model default configuration
   */
  const loadModelConfig = async () => {
    const modelId = chatStore.chatConfig.modelId
    const providerId = chatStore.chatConfig.providerId

    if (!modelId || !providerId) return

    try {
      const config = await configPresenter.getModelDefaultConfig(modelId, providerId)
      configModelType.value = (config.type as ModelType) ?? ModelType.Chat

      configContextLengthLimit.value = config.contextLength
      configMaxTokensLimit.value = config.maxTokens

      if (configContextLength.value > config.contextLength) {
        configContextLength.value = config.contextLength
      } else if (configContextLength.value < 2048) {
        configContextLength.value = Math.max(2048, config.contextLength)
      }

      const maxTokensMax = !config.maxTokens || config.maxTokens < 8192 ? 8192 : config.maxTokens
      if (configMaxTokens.value > maxTokensMax) {
        configMaxTokens.value = maxTokensMax
      } else if (configMaxTokens.value < 1024) {
        configMaxTokens.value = 1024
      }

      if (configTemperature.value === undefined || configTemperature.value === null) {
        configTemperature.value = config.temperature ?? 0.6
      }

      if (config.thinkingBudget !== undefined) {
        if (configThinkingBudget.value === undefined) {
          configThinkingBudget.value = config.thinkingBudget
        } else {
          if (configThinkingBudget.value < -1) {
            configThinkingBudget.value = -1
          } else if (configThinkingBudget.value > 32768) {
            configThinkingBudget.value = 32768
          }
        }
      } else {
        configThinkingBudget.value = undefined
      }

      if (config.enableSearch !== undefined && configEnableSearch.value === undefined) {
        configEnableSearch.value = config.enableSearch
      }

      if (config.forcedSearch !== undefined && configForcedSearch.value === undefined) {
        configForcedSearch.value = config.forcedSearch
      }

      if (config.searchStrategy !== undefined && configSearchStrategy.value === undefined) {
        configSearchStrategy.value = config.searchStrategy
      }

      if (config.reasoningEffort !== undefined) {
        if (configReasoningEffort.value === undefined) {
          configReasoningEffort.value = config.reasoningEffort
        }
      } else {
        configReasoningEffort.value = undefined
      }

      if (config.verbosity !== undefined) {
        if (configVerbosity.value === undefined) {
          configVerbosity.value = config.verbosity
        }
      } else {
        configVerbosity.value = undefined
      }
    } catch (error) {
      console.error('Failed to load model config:', error)
    }
  }

  // === Public Methods ===
  /**
   * Handle model update from ModelChooser
   */
  const handleModelUpdate = (model: MODEL_META) => {
    chatStore.updateChatConfig({
      modelId: model.id,
      providerId: model.providerId
    })

    configPresenter.setSetting('preferredModel', {
      modelId: model.id,
      providerId: model.providerId
    })
  }

  // === Watchers ===
  /**
   * Debounced watcher: Local config -> Store (300ms debounce to reduce updates)
   */
  const syncConfigToStore = useDebounceFn(() => {
    const currentConfig = chatStore.chatConfig
    if (
      configTemperature.value !== currentConfig.temperature ||
      configContextLength.value !== currentConfig.contextLength ||
      configMaxTokens.value !== currentConfig.maxTokens ||
      configSystemPrompt.value !== currentConfig.systemPrompt ||
      configArtifacts.value !== currentConfig.artifacts ||
      configThinkingBudget.value !== currentConfig.thinkingBudget ||
      configEnableSearch.value !== currentConfig.enableSearch ||
      configForcedSearch.value !== currentConfig.forcedSearch ||
      configSearchStrategy.value !== currentConfig.searchStrategy ||
      configReasoningEffort.value !== currentConfig.reasoningEffort ||
      configVerbosity.value !== currentConfig.verbosity
    ) {
      chatStore.updateChatConfig({
        temperature: configTemperature.value,
        contextLength: configContextLength.value,
        maxTokens: configMaxTokens.value,
        systemPrompt: configSystemPrompt.value,
        artifacts: configArtifacts.value,
        thinkingBudget: configThinkingBudget.value,
        enableSearch: configEnableSearch.value,
        forcedSearch: configForcedSearch.value,
        searchStrategy: configSearchStrategy.value,
        reasoningEffort: configReasoningEffort.value,
        verbosity: configVerbosity.value
      } as any)
    }
  }, 300)

  watch(
    [
      configTemperature,
      configContextLength,
      configMaxTokens,
      configSystemPrompt,
      configArtifacts,
      configThinkingBudget,
      configEnableSearch,
      configForcedSearch,
      configSearchStrategy,
      configReasoningEffort,
      configVerbosity
    ],
    syncConfigToStore
  )

  /**
   * Watcher: Store -> Local config (immediate sync)
   */
  watch(
    () => chatStore.chatConfig,
    async (newConfig, oldConfig) => {
      configTemperature.value = newConfig.temperature
      configContextLength.value = newConfig.contextLength
      configMaxTokens.value = newConfig.maxTokens
      configSystemPrompt.value = newConfig.systemPrompt
      configArtifacts.value = newConfig.artifacts
      configThinkingBudget.value = newConfig.thinkingBudget
      configEnableSearch.value = newConfig.enableSearch
      configForcedSearch.value = newConfig.forcedSearch
      configSearchStrategy.value = newConfig.searchStrategy
      configReasoningEffort.value = newConfig.reasoningEffort
      configVerbosity.value = newConfig.verbosity

      if (
        oldConfig &&
        (newConfig.modelId !== oldConfig.modelId || newConfig.providerId !== oldConfig.providerId)
      ) {
        await loadModelConfig()
      }
    },
    { deep: true }
  )

  // === Return Public API ===
  return {
    // State
    configTemperature,
    configContextLength,
    configContextLengthLimit,
    configMaxTokens,
    configMaxTokensLimit,
    configSystemPrompt,
    configArtifacts,
    configThinkingBudget,
    configEnableSearch,
    configForcedSearch,
    configSearchStrategy,
    configReasoningEffort,
    configVerbosity,
    configModelType,

    // Computed
    activeModel,
    modelDisplayName,

    // Methods
    loadModelConfig,
    handleModelUpdate
  }
}
