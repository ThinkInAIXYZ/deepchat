import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useChatStore } from './chat'
import { WORKSPACE_EVENTS } from '@/events'
import type {
  WorkspacePlanEntry,
  WorkspaceFileNode,
  WorkspaceTerminalSnippet
} from '@shared/presenter'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'

// Debounce delay for file tree refresh (ms)
const FILE_REFRESH_DEBOUNCE_MS = 500

export const useWorkspaceStore = defineStore('workspace', () => {
  const chatStore = useChatStore()
  const workspacePresenter = usePresenter('workspacePresenter')
  const chatMode = useChatMode()

  const isAcpAgentMode = computed(() => chatMode.currentMode.value === 'acp agent')

  // === State ===
  const isOpen = ref(false)
  const isLoading = ref(false)
  const planEntries = ref<WorkspacePlanEntry[]>([])
  const fileTree = ref<WorkspaceFileNode[]>([])
  const terminalSnippets = ref<WorkspaceTerminalSnippet[]>([])
  const lastSyncedConversationId = ref<string | null>(null)
  const lastSuccessfulWorkspace = ref<string | null>(null)

  // Debounce timer for file refresh
  let fileRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // === Computed Properties ===
  const isAgentMode = computed(
    () => chatMode.currentMode.value === 'agent' || chatMode.currentMode.value === 'acp agent'
  )

  const currentWorkspacePath = computed(() => {
    // For acp agent mode, use ACP workdir
    if (chatMode.currentMode.value === 'acp agent') {
      const modelId = chatStore.chatConfig.modelId
      if (!modelId) return null
      return chatStore.chatConfig.acpWorkdirMap?.[modelId] ?? null
    }
    // For agent mode, use agentWorkspacePath
    return chatStore.chatConfig.agentWorkspacePath ?? null
  })

  const completedPlanCount = computed(
    () => planEntries.value.filter((e) => e.status === 'completed').length
  )

  const totalPlanCount = computed(() => planEntries.value.length)

  const planProgress = computed(() => {
    if (totalPlanCount.value === 0) return 0
    return Math.round((completedPlanCount.value / totalPlanCount.value) * 100)
  })

  // === Methods ===
  const toggle = () => {
    isOpen.value = !isOpen.value
  }

  const setOpen = (open: boolean) => {
    isOpen.value = open
  }

  const refreshFileTree = async () => {
    const workspacePath = currentWorkspacePath.value
    const conversationIdBefore = chatStore.getActiveThreadId()

    if (!workspacePath) {
      fileTree.value = []
      return
    }

    // Register workspace/workdir before reading (security boundary) - await to ensure completion
    if (isAcpAgentMode.value) {
      await (workspacePresenter as any).registerWorkdir(workspacePath)
    } else {
      await (workspacePresenter as any).registerWorkspace(workspacePath)
    }

    isLoading.value = true
    try {
      // Only read first level (lazy loading)
      const result = (await workspacePresenter.readDirectory(workspacePath)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        fileTree.value = result as WorkspaceFileNode[]
        lastSuccessfulWorkspace.value = workspacePath
      }
    } catch (error) {
      console.error('[Workspace] Failed to load file tree:', error)
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        if (lastSuccessfulWorkspace.value !== workspacePath) {
          fileTree.value = []
        }
      }
    } finally {
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        isLoading.value = false
      }
    }
  }

  /**
   * Debounced file tree refresh - merges multiple refresh requests within a short time window
   */
  const debouncedRefreshFileTree = () => {
    if (fileRefreshDebounceTimer) {
      clearTimeout(fileRefreshDebounceTimer)
    }
    fileRefreshDebounceTimer = setTimeout(() => {
      fileRefreshDebounceTimer = null
      refreshFileTree()
    }, FILE_REFRESH_DEBOUNCE_MS)
  }

  /**
   * Load children for a directory node (lazy loading)
   */
  const loadDirectoryChildren = async (node: WorkspaceFileNode): Promise<void> => {
    if (!node.isDirectory) return

    try {
      const children = (await workspacePresenter.expandDirectory(node.path)) ?? []
      node.children = children as WorkspaceFileNode[]
      node.expanded = true
    } catch (error) {
      console.error('[Workspace] Failed to load directory children:', error)
      node.children = []
      node.expanded = true
    }
  }

  const refreshPlanEntries = async () => {
    const conversationId = chatStore.getActiveThreadId()
    if (!conversationId) {
      planEntries.value = []
      return
    }

    try {
      const result = (await workspacePresenter.getPlanEntries(conversationId)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (chatStore.getActiveThreadId() === conversationId) {
        planEntries.value = result as WorkspacePlanEntry[]
      }
    } catch (error) {
      console.error('[Workspace] Failed to load plan entries:', error)
    }
  }

  /**
   * Toggle file node expansion (with lazy loading support)
   */
  const toggleFileNode = async (node: WorkspaceFileNode): Promise<void> => {
    if (!node.isDirectory) return

    if (node.expanded) {
      // Collapse: just toggle expanded state
      node.expanded = false
    } else {
      // Expand: load children if not yet loaded
      if (node.children === undefined) {
        await loadDirectoryChildren(node)
      } else {
        node.expanded = true
      }
    }
  }

  const clearData = () => {
    planEntries.value = []
    fileTree.value = []
    terminalSnippets.value = []
    lastSyncedConversationId.value = null
    lastSuccessfulWorkspace.value = null
  }

  // === Event Listeners ===
  const setupEventListeners = () => {
    // Plan update event
    window.electron.ipcRenderer.on(
      WORKSPACE_EVENTS.PLAN_UPDATED,
      (_, payload: { conversationId: string; entries: WorkspacePlanEntry[] }) => {
        if (payload.conversationId === chatStore.getActiveThreadId()) {
          planEntries.value = payload.entries
        }
      }
    )

    // Terminal output event
    window.electron.ipcRenderer.on(
      WORKSPACE_EVENTS.TERMINAL_OUTPUT,
      (_, payload: { conversationId: string; snippet: WorkspaceTerminalSnippet }) => {
        if (payload.conversationId === chatStore.getActiveThreadId()) {
          // Keep latest 10 items
          terminalSnippets.value = [payload.snippet, ...terminalSnippets.value.slice(0, 9)]
        }
      }
    )

    // File change event - refresh file tree (debounced to merge rapid updates)
    window.electron.ipcRenderer.on(
      WORKSPACE_EVENTS.FILES_CHANGED,
      (_, payload: { conversationId: string }) => {
        if (payload.conversationId === chatStore.getActiveThreadId() && isAgentMode.value) {
          debouncedRefreshFileTree()
        }
      }
    )
  }

  // === Watchers ===
  // Watch for conversation changes
  watch(
    () => chatStore.getActiveThreadId(),
    async (newId) => {
      if (newId !== lastSyncedConversationId.value) {
        lastSyncedConversationId.value = newId ?? null
        if (newId && isAgentMode.value) {
          await Promise.all([refreshPlanEntries(), refreshFileTree()])
        } else {
          clearData()
        }
      }
    }
  )

  // Watch for workspace path changes
  watch(
    currentWorkspacePath,
    (workspacePath, previousWorkspacePath) => {
      if (workspacePath !== previousWorkspacePath) {
        lastSuccessfulWorkspace.value = null
      }

      if (isAgentMode.value && workspacePath) {
        refreshFileTree()
      }
    },
    { immediate: true }
  )

  // Watch for Agent mode changes
  watch(
    isAgentMode,
    (isAgent) => {
      if (isAgent) {
        setOpen(true)
        refreshFileTree()
        refreshPlanEntries()
      } else {
        setOpen(false)
        clearData()
      }
    },
    { immediate: true }
  )

  // Initialize event listeners
  setupEventListeners()

  return {
    // State
    isOpen,
    isLoading,
    planEntries,
    fileTree,
    terminalSnippets,
    // Computed
    isAgentMode,
    currentWorkspacePath,
    completedPlanCount,
    totalPlanCount,
    planProgress,
    // Methods
    toggle,
    setOpen,
    refreshFileTree,
    refreshPlanEntries,
    toggleFileNode,
    loadDirectoryChildren,
    clearData
  }
})
