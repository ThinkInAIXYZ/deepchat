// === Vue Core ===
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'

// === Types ===
import type { Ref } from 'vue'

export interface UseAgentWorkspaceOptions {
  conversationId: Ref<string | null>
  activeModel: Ref<{ id: string; providerId: string } | null>
}

/**
 * Unified workspace path management composable
 * Handles workspace path selection for agent mode
 */
export function useAgentWorkspace(options: UseAgentWorkspaceOptions) {
  const { t } = useI18n()
  const conversationCore = useConversationCore()

  // Agent workspace path
  const agentWorkspacePath = ref<string | null>(null)
  const pendingWorkspacePath = ref<string | null>(null)
  const loading = ref(false)

  // === Computed ===
  const hasWorkspace = computed(() => {
    return Boolean(pendingWorkspacePath.value ?? agentWorkspacePath.value)
  })

  const workspacePath = computed(() => {
    return pendingWorkspacePath.value ?? agentWorkspacePath.value
  })

  const tooltipTitle = computed(() => {
    return t('chat.input.agentWorkspaceTooltip')
  })

  const tooltipCurrent = computed(() => {
    if (!hasWorkspace.value) return ''
    return t('chat.input.agentWorkspaceCurrent', { path: workspacePath.value || '' })
  })

  const tooltipSelect = computed(() => {
    return t('chat.input.agentWorkspaceSelect')
  })

  // === Methods ===
  const selectWorkspace = async () => {
    // For agent mode, select workspace path
    loading.value = true
    try {
      const devicePresenter = usePresenter('devicePresenter')
      const result = await devicePresenter.selectDirectory()

      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        agentWorkspacePath.value = selectedPath

        // Save to conversation settings when available
        if (options.conversationId.value) {
          await conversationCore.updateConversationSettings(options.conversationId.value, {
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
    if (!options.conversationId.value) {
      return
    }

    try {
      // Load agent workspace path from conversation settings
      const conversation = await conversationCore.getConversation(options.conversationId.value)
      const savedPath = conversation?.settings?.agentWorkspacePath ?? null
      if (savedPath) {
        agentWorkspacePath.value = savedPath
        pendingWorkspacePath.value = null
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
    const selectedPath = pendingWorkspacePath.value
    if (!selectedPath || !options.conversationId.value) return

    loading.value = true
    try {
      await conversationCore.updateConversationSettings(options.conversationId.value, {
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

  // Watch for conversationId changes
  watch(
    () => options.conversationId.value,
    async (conversationId) => {
      if (pendingWorkspacePath.value && conversationId) {
        await syncPendingWorkspaceWhenReady()
      }
      if (conversationId) {
        await loadWorkspacePath()
      }
    },
    { immediate: true }
  )

  // Stub values for ACP workdir change confirmation (no longer used)
  const showWorkdirChangeConfirm = ref(false)
  const pendingWorkdirChange = ref<string | null>(null)
  const confirmWorkdirChange = async () => {}
  const cancelWorkdirChange = () => {}

  return {
    hasWorkspace,
    workspacePath,
    loading,
    tooltipTitle,
    tooltipCurrent,
    tooltipSelect,
    selectWorkspace,
    loadWorkspacePath,
    // Stub values for API compatibility
    showWorkdirChangeConfirm,
    pendingWorkdirChange,
    confirmWorkdirChange,
    cancelWorkdirChange
  }
}
