import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useChatStore } from './chat'
import { WORKSPACE_EVENTS } from '@/events'
import type { AcpPlanEntry, AcpFileNode, AcpTerminalSnippet } from '@shared/presenter'

// Debounce delay for file tree refresh (ms)
const FILE_REFRESH_DEBOUNCE_MS = 500

export const useAcpWorkspaceStore = defineStore('acpWorkspace', () => {
  const chatStore = useChatStore()
  const acpWorkspacePresenter = usePresenter('acpWorkspacePresenter')

  // === State ===
  const isOpen = ref(false)
  const isLoading = ref(false)
  const planEntries = ref<AcpPlanEntry[]>([])
  const fileTree = ref<AcpFileNode[]>([])
  const terminalSnippets = ref<AcpTerminalSnippet[]>([])
  const lastSyncedConversationId = ref<string | null>(null)
  const lastSuccessfulWorkdir = ref<string | null>(null)

  // Debounce timer for file refresh
  let fileRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // === Computed Properties ===
  const isAcpMode = computed(() => chatStore.chatConfig.providerId === 'acp')

  const currentWorkdir = computed(() => {
    const modelId = chatStore.chatConfig.modelId
    if (!modelId) return null
    return chatStore.chatConfig.acpWorkdirMap?.[modelId] ?? null
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
    const workdir = currentWorkdir.value
    const conversationIdBefore = chatStore.getActiveThreadId()

    if (!workdir) {
      fileTree.value = []
      return
    }

    // Register workdir before reading (security boundary) - await to ensure completion
    await acpWorkspacePresenter.registerWorkdir(workdir)

    isLoading.value = true
    try {
      // Only read first level (lazy loading)
      const result = (await acpWorkspacePresenter.readDirectory(workdir)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        fileTree.value = result
        lastSuccessfulWorkdir.value = workdir
      }
    } catch (error) {
      console.error('[AcpWorkspace] Failed to load file tree:', error)
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        if (lastSuccessfulWorkdir.value !== workdir) {
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
  const loadDirectoryChildren = async (node: AcpFileNode): Promise<void> => {
    if (!node.isDirectory) return

    try {
      const children = (await acpWorkspacePresenter.expandDirectory(node.path)) ?? []
      node.children = children
      node.expanded = true
    } catch (error) {
      console.error('[AcpWorkspace] Failed to load directory children:', error)
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
      const result = (await acpWorkspacePresenter.getPlanEntries(conversationId)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (chatStore.getActiveThreadId() === conversationId) {
        planEntries.value = result
      }
    } catch (error) {
      console.error('[AcpWorkspace] Failed to load plan entries:', error)
    }
  }

  /**
   * Toggle file node expansion (with lazy loading support)
   */
  const toggleFileNode = async (node: AcpFileNode): Promise<void> => {
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
    lastSuccessfulWorkdir.value = null
  }

  // === Event Listeners ===
  const setupEventListeners = () => {
    // Plan update event
    window.electron.ipcRenderer.on(
      WORKSPACE_EVENTS.PLAN_UPDATED,
      (_, payload: { conversationId: string; entries: AcpPlanEntry[] }) => {
        if (payload.conversationId === chatStore.getActiveThreadId()) {
          planEntries.value = payload.entries
        }
      }
    )

    // Terminal output event
    window.electron.ipcRenderer.on(
      WORKSPACE_EVENTS.TERMINAL_OUTPUT,
      (_, payload: { conversationId: string; snippet: AcpTerminalSnippet }) => {
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
        if (payload.conversationId === chatStore.getActiveThreadId() && isAcpMode.value) {
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
        if (newId && isAcpMode.value) {
          await Promise.all([refreshPlanEntries(), refreshFileTree()])
        } else {
          clearData()
        }
      }
    }
  )

  // Watch for workdir changes
  watch(
    currentWorkdir,
    (workdir, previousWorkdir) => {
      if (workdir !== previousWorkdir) {
        lastSuccessfulWorkdir.value = null
      }

      if (isAcpMode.value && workdir) {
        refreshFileTree()
      }
    },
    { immediate: true }
  )

  // Watch for ACP mode changes
  watch(
    isAcpMode,
    (isAcp) => {
      if (isAcp) {
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
    isAcpMode,
    currentWorkdir,
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
