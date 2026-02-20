import { ref, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/modelStore'
import { useAgentStore } from '@/stores/agent'
import { usePresenter } from '@/composables/usePresenter'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import type { AcpAgent } from '@shared/types/presenters/agentConfig.presenter'
import { usePromptInputConfig } from '@/components/chat-input/composables/usePromptInputConfig'

type EffortLevel = 'minimal' | 'low' | 'medium' | 'high'
type VerbosityLevel = 'low' | 'medium' | 'high'

export function useNewThreadStatusBar() {
  const chatStore = useChatStore()
  const modelStore = useModelStore()
  const agentStore = useAgentStore()
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

  // Get current active model from chat config
  const activeModel = computed(() => {
    const modelId = chatStore.chatConfig.modelId
    const providerId = chatStore.chatConfig.providerId

    if (!modelId || !providerId) {
      return {
        name: modelId || 'Unknown Model',
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

  // Handle model selection
  const selectModel = async (model: RENDERER_MODEL_META) => {
    await chatStore.updateChatConfig({
      modelId: model.id,
      providerId: model.providerId
    })
    await promptConfig.loadModelConfig()
    // Save as preferred model
    await configPresenter.setSetting('preferredModel', {
      modelId: model.id,
      providerId: model.providerId
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
