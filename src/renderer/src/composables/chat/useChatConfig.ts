import { ref, type Ref } from 'vue'
import type { CONVERSATION_SETTINGS, CONVERSATION } from '@shared/presenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'

/**
 * Chat configuration composable
 * Handles conversation settings, ACP workdir preferences, and agent workspace preferences
 */
export function useChatConfig(
  activeThreadId: Ref<string | null>,
  threads: Ref<{ dt: string; dtThreads: CONVERSATION[] }[]>,
  selectedVariantsMap: Ref<Record<string, string>>
) {
  const conversationCore = useConversationCore()

  // Chat configuration state
  const chatConfig = ref<CONVERSATION_SETTINGS>({
    systemPrompt: '',
    systemPromptId: 'default',
    temperature: 0.7,
    contextLength: 32000,
    maxTokens: 8000,
    providerId: '',
    modelId: '',
    artifacts: 0,
    enabledMcpTools: [],
    thinkingBudget: undefined,
    enableSearch: undefined,
    forcedSearch: undefined,
    searchStrategy: undefined,
    reasoningEffort: undefined,
    verbosity: undefined,
    selectedVariantsMap: {},
    acpWorkdirMap: {},
    agentWorkspacePath: null
  })

  /**
   * Load chat configuration for active thread
   */
  const loadChatConfig = async () => {
    const activeThread = activeThreadId.value
    if (!activeThread) return

    try {
      const conversation = await conversationCore.getConversation(activeThread)
      const threadToUpdate = threads.value
        .flatMap((thread) => thread.dtThreads)
        .find((t) => t.id === activeThread)

      if (threadToUpdate) {
        Object.assign(threadToUpdate, conversation)
      }

      if (conversation) {
        const normalizedSettings = { ...conversation.settings }
        chatConfig.value = {
          ...normalizedSettings,
          acpWorkdirMap: normalizedSettings.acpWorkdirMap ?? {}
        }

        // Populate the in-memory map from the loaded settings
        if (conversation.settings.selectedVariantsMap) {
          selectedVariantsMap.value = { ...conversation.settings.selectedVariantsMap }
        } else {
          selectedVariantsMap.value = {}
        }
      }
    } catch (error) {
      console.error('Failed to load conversation config:', error)
      throw error
    }
  }

  /**
   * Save chat configuration to backend
   */
  const saveChatConfig = async () => {
    const activeThread = activeThreadId.value
    if (!activeThread) return

    try {
      await conversationCore.updateConversationSettings(activeThread, chatConfig.value)
    } catch (error) {
      console.error('Failed to save conversation config:', error)
      throw error
    }
  }

  /**
   * Update chat configuration
   * @param newConfig Partial configuration to update
   */
  const updateChatConfig = async (newConfig: Partial<CONVERSATION_SETTINGS>) => {
    chatConfig.value = { ...chatConfig.value, ...newConfig }
    await saveChatConfig()

    // Refresh sidebar icon if modelId or chatMode changed
    const activeThread = activeThreadId.value
    if (activeThread && (newConfig.modelId !== undefined || newConfig.chatMode !== undefined)) {
      const { useSidebarStore } = await import('@/stores/sidebarStore')
      const sidebarStore = useSidebarStore()
      await sidebarStore.refreshConversationMeta(activeThread)
    }
  }

  /**
   * Set ACP workdir preference for an agent
   * @param agentId Agent ID
   * @param workdir Working directory path
   */
  const setAcpWorkdirPreference = (agentId: string, workdir: string | null) => {
    if (!agentId) return

    const currentMap = chatConfig.value.acpWorkdirMap ?? {}
    const nextMap = { ...currentMap }

    if (workdir && workdir.trim().length > 0) {
      nextMap[agentId] = workdir
    } else {
      delete nextMap[agentId]
    }

    chatConfig.value = { ...chatConfig.value, acpWorkdirMap: nextMap }
  }

  /**
   * Set agent workspace preference
   * @param workspacePath Workspace path
   */
  const setAgentWorkspacePreference = (workspacePath: string | null) => {
    const nextPath = workspacePath?.trim() ? workspacePath : null
    chatConfig.value = { ...chatConfig.value, agentWorkspacePath: nextPath }
  }

  /**
   * Reset chat config to defaults
   */
  const resetChatConfig = () => {
    chatConfig.value = {
      systemPrompt: '',
      systemPromptId: 'default',
      temperature: 0.7,
      contextLength: 32000,
      maxTokens: 8000,
      providerId: '',
      modelId: '',
      artifacts: 0,
      enabledMcpTools: [],
      thinkingBudget: undefined,
      enableSearch: undefined,
      forcedSearch: undefined,
      searchStrategy: undefined,
      reasoningEffort: undefined,
      verbosity: undefined,
      selectedVariantsMap: {},
      acpWorkdirMap: {},
      agentWorkspacePath: null
    }
  }

  return {
    // State
    chatConfig,

    // Methods
    loadChatConfig,
    saveChatConfig,
    updateChatConfig,
    setAcpWorkdirPreference,
    setAgentWorkspacePreference,
    resetChatConfig
  }
}
