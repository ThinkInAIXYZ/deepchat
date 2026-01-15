// === Vue Core ===
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useChatMode } from './useChatMode'
import { useAcpWorkdir } from './useAcpWorkdir'
import { useChatStore } from '@/stores/chat'

// === Types ===
import type { Ref } from 'vue'

export interface UseAgentWorkspaceOptions {
  conversationId: Ref<string | null>
  activeModel: Ref<{ id: string; providerId: string } | null>
  chatMode?: ReturnType<typeof useChatMode>
}

/**
 * Unified workspace path management composable
 * Handles workspace path selection for both agent and acp agent modes
 */
export function useAgentWorkspace(options: UseAgentWorkspaceOptions) {
  const { t } = useI18n()
  const sessionPresenter = usePresenter('sessionPresenter')
  const chatMode = options.chatMode ?? useChatMode()
  const chatStore = useChatStore()

  // Use ACP workdir for acp agent mode
  const acpWorkdir = useAcpWorkdir({
    conversationId: options.conversationId,
    activeModel: options.activeModel
  })

  // Agent workspace path (for agent mode)
  const agentWorkspacePath = ref<string | null>(null)
  const pendingWorkspacePath = ref<string | null>(null)
  const loading = ref(false)
  const syncPreference = (workspacePath: string | null) => {
    const setPreference = (
      chatStore as {
        setAgentWorkspacePreference?: (path: string | null) => void
        updateChatConfig?: (config: { agentWorkspacePath?: string | null }) => Promise<void>
      }
    ).setAgentWorkspacePreference

    if (typeof setPreference === 'function') {
      setPreference(workspacePath)
      return
    }

    if (typeof chatStore.updateChatConfig === 'function') {
      void chatStore.updateChatConfig({ agentWorkspacePath: workspacePath })
    }
  }

  const hydrateWorkspaceFromPreference = () => {
    if (pendingWorkspacePath.value || agentWorkspacePath.value) return
    const storedPath = chatStore.chatConfig.agentWorkspacePath ?? null
    if (storedPath) {
      agentWorkspacePath.value = storedPath
    }
  }

  // === Computed ===
  const hasWorkspace = computed(() => {
    if (chatMode.currentMode.value === 'acp agent') {
      return acpWorkdir.hasWorkdir.value
    }
    return Boolean(pendingWorkspacePath.value ?? agentWorkspacePath.value)
  })

  const workspacePath = computed(() => {
    if (chatMode.currentMode.value === 'acp agent') {
      return acpWorkdir.workdir.value
    }
    return pendingWorkspacePath.value ?? agentWorkspacePath.value
  })

  const tooltipTitle = computed(() => {
    if (chatMode.currentMode.value === 'acp agent') {
      return t('chat.input.acpWorkdirTooltip')
    }
    return t('chat.input.agentWorkspaceTooltip')
  })

  const tooltipCurrent = computed(() => {
    if (!hasWorkspace.value) return ''
    if (chatMode.currentMode.value === 'acp agent') {
      return t('chat.input.acpWorkdirCurrent', { path: workspacePath.value || '' })
    }
    return t('chat.input.agentWorkspaceCurrent', { path: workspacePath.value || '' })
  })

  const tooltipSelect = computed(() => {
    if (chatMode.currentMode.value === 'acp agent') {
      return t('chat.input.acpWorkdirSelect')
    }
    return t('chat.input.agentWorkspaceSelect')
  })

  // === Methods ===
  const selectWorkspace = async () => {
    if (chatMode.currentMode.value === 'acp agent') {
      // Use ACP workdir selection
      await acpWorkdir.selectWorkdir()
      return
    }

    // For agent mode, select workspace path
    loading.value = true
    try {
      const devicePresenter = usePresenter('devicePresenter')
      const result = await devicePresenter.selectDirectory()

      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        agentWorkspacePath.value = selectedPath
        syncPreference(selectedPath)

        // Save to conversation settings when available
        if (options.conversationId.value) {
          await sessionPresenter.updateConversationSettings(options.conversationId.value, {
            agentWorkspacePath: selectedPath
          })
          pendingWorkspacePath.value = null
        } else {
          pendingWorkspacePath.value = selectedPath
        }

        // Register workspace with presenter
        const workspacePresenter = usePresenter('workspacePresenter')
        await workspacePresenter.registerWorkspace(selectedPath)
      }
    } catch (error) {
      console.error('[useAgentWorkspace] Failed to select workspace:', error)
    } finally {
      loading.value = false
    }
  }

  // Load workspace path from conversation settings
  const loadWorkspacePath = async () => {
    if (chatMode.currentMode.value === 'acp agent') {
      // ACP workdir is loaded by useAcpWorkdir
      return
    }

    if (!options.conversationId.value) {
      hydrateWorkspaceFromPreference()
      return
    }

    try {
      // Load agent workspace path from conversation settings
      const conversation = await sessionPresenter.getConversation(options.conversationId.value)
      const savedPath = conversation?.settings?.agentWorkspacePath ?? null
      if (savedPath) {
        agentWorkspacePath.value = savedPath
        pendingWorkspacePath.value = null
        syncPreference(savedPath)
        // Register workspace with presenter
        const workspacePresenter = usePresenter('workspacePresenter')
        await workspacePresenter.registerWorkspace(savedPath)
      } else if (!pendingWorkspacePath.value) {
        agentWorkspacePath.value = null
      }
    } catch (error) {
      console.error('[useAgentWorkspace] Failed to load workspace path:', error)
    }
  }

  const syncPendingWorkspaceWhenReady = async () => {
    if (chatMode.currentMode.value !== 'agent') return
    const selectedPath = pendingWorkspacePath.value
    if (!selectedPath || !options.conversationId.value) return

    loading.value = true
    try {
      await sessionPresenter.updateConversationSettings(options.conversationId.value, {
        agentWorkspacePath: selectedPath
      })
      agentWorkspacePath.value = selectedPath
      pendingWorkspacePath.value = null

      const workspacePresenter = usePresenter('workspacePresenter')
      await workspacePresenter.registerWorkspace(selectedPath)
    } catch (error) {
      console.error('[useAgentWorkspace] Failed to sync pending workspace:', error)
    } finally {
      loading.value = false
    }
  }

  watch(
    () => options.conversationId.value,
    () => {
      if (pendingWorkspacePath.value) {
        void syncPendingWorkspaceWhenReady()
      }
    }
  )

  // Watch for chatMode and conversationId changes
  watch(
    [() => chatMode.currentMode.value, () => options.conversationId.value],
    async ([newMode, conversationId]) => {
      if (newMode === 'agent') {
        if (pendingWorkspacePath.value && conversationId) {
          await syncPendingWorkspaceWhenReady()
        }
        if (conversationId) {
          await loadWorkspacePath()
        } else {
          hydrateWorkspaceFromPreference()
        }
        return
      }

      if (newMode === 'acp agent') {
        // ACP workdir is handled by useAcpWorkdir
        return
      }
    },
    { immediate: true }
  )

  return {
    hasWorkspace,
    workspacePath,
    loading,
    tooltipTitle,
    tooltipCurrent,
    tooltipSelect,
    selectWorkspace,
    loadWorkspacePath,
    // ACP workdir change confirmation dialog state and methods
    showWorkdirChangeConfirm: acpWorkdir.showWorkdirChangeConfirm,
    pendingWorkdirChange: acpWorkdir.pendingWorkdirChange,
    confirmWorkdirChange: acpWorkdir.confirmWorkdirChange,
    cancelWorkdirChange: acpWorkdir.cancelWorkdirChange
  }
}
