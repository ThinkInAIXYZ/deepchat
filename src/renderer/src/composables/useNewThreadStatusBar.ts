import { ref, computed, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/modelStore'
import { useAgentStore } from '@/stores/agent'
import { usePresenter } from '@/composables/usePresenter'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import type { AcpAgent } from '@shared/types/presenters/agentConfig.presenter'

export function useNewThreadStatusBar() {
  const chatStore = useChatStore()
  const modelStore = useModelStore()
  const agentStore = useAgentStore()
  const configPresenter = usePresenter('configPresenter')

  // Local state for effort and permissions
  const selectedEffort = ref<'low' | 'medium' | 'high' | 'extra-high'>('high')
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
    // Save as preferred model
    await configPresenter.setSetting('preferredModel', {
      modelId: model.id,
      providerId: model.providerId
    })
  }

  // Handle effort selection
  const selectEffort = (effort: 'low' | 'medium' | 'high' | 'extra-high') => {
    selectedEffort.value = effort
    void chatStore.updateChatConfig({
      reasoningEffort: effort === 'extra-high' ? 'high' : effort
    })
  }

  // Handle permission selection
  const selectPermission = (permission: 'default' | 'restricted' | 'full') => {
    selectedPermission.value = permission
  }

  const normalizeEffort = (
    effort: 'minimal' | 'low' | 'medium' | 'high' | undefined
  ): 'low' | 'medium' | 'high' | 'extra-high' => {
    if (effort === 'minimal') return 'low'
    return effort || 'high'
  }

  // Watch for config changes
  watch(
    () => chatStore.chatConfig.reasoningEffort,
    (newValue) => {
      selectedEffort.value = normalizeEffort(newValue)
    },
    { immediate: true }
  )

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
    selectEffort,

    // Permissions
    selectedPermission,
    selectPermission
  }
}
