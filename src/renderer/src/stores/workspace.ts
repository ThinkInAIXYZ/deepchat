import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useChatStore } from './chat'
import { WORKSPACE_EVENTS } from '@/events'
import type {
  WorkspacePlanEntry,
  WorkspaceFileNode,
  WorkspaceTerminalSnippet,
  IPresenter
} from '@shared/presenter'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'

// Debounce delay for file tree refresh (ms)
const FILE_REFRESH_DEBOUNCE_MS = 500

type WorkspacePresenter = IPresenter['workspacePresenter']

type WorkspaceStoreDeps = {
  chatStore?: ReturnType<typeof useChatStore>
  chatMode?: ReturnType<typeof useChatMode>
  workspacePresenter?: WorkspacePresenter
  ipcRenderer?: typeof window.electron.ipcRenderer | null
  enableWatchers?: boolean
}

export const createWorkspaceStore = (deps: WorkspaceStoreDeps = {}) => {
  const chatStore = deps.chatStore ?? useChatStore()
  const workspacePresenter = deps.workspacePresenter ?? usePresenter('workspacePresenter')
  const chatMode = deps.chatMode ?? useChatMode()
  const ipcRenderer = deps.ipcRenderer ?? window?.electron?.ipcRenderer ?? null

  const isAcpAgentMode = computed(() => chatMode.currentMode.value === 'acp agent')

  // === State ===
  const isOpen = ref(false)
  const isLoading = ref(false)
  const planEntries = ref<WorkspacePlanEntry[]>([])
  const fileTree = ref<WorkspaceFileNode[]>([])
  const terminalSnippets = ref<WorkspaceTerminalSnippet[]>([])
  const expandedSnippetIds = ref<Set<string>>(new Set())
  const lastSyncedConversationId = ref<string | null>(null)
  const lastSuccessfulWorkspace = ref<string | null>(null)

  // Debounce timer for file refresh
  let fileRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let fileRefreshRequestId = 0
  let planRefreshRequestId = 0
  let listenersBound = false

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

  const isFileRefreshCurrent = (conversationId: string | null, workspacePath: string | null) => {
    if (!conversationId || !workspacePath) return false
    return (
      chatStore.activeThreadId === conversationId && currentWorkspacePath.value === workspacePath
    )
  }

  const isPlanRefreshCurrent = (conversationId: string | null, requestId: number) => {
    if (!conversationId) return false
    return requestId === planRefreshRequestId && chatStore.activeThreadId === conversationId
  }

  const refreshFileTree = async () => {
    const workspacePath = currentWorkspacePath.value
    const conversationIdBefore = chatStore.activeThreadId
    const requestId = ++fileRefreshRequestId

    if (!workspacePath || !conversationIdBefore) {
      fileTree.value = []
      isLoading.value = false
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
      if (
        requestId === fileRefreshRequestId &&
        isFileRefreshCurrent(conversationIdBefore, workspacePath)
      ) {
        fileTree.value = result as WorkspaceFileNode[]
        lastSuccessfulWorkspace.value = workspacePath
      }
    } catch (error) {
      console.error('[Workspace] Failed to load file tree:', error)
      if (
        requestId === fileRefreshRequestId &&
        isFileRefreshCurrent(conversationIdBefore, workspacePath) &&
        lastSuccessfulWorkspace.value !== workspacePath
      ) {
        fileTree.value = []
      }
    } finally {
      if (
        requestId === fileRefreshRequestId &&
        isFileRefreshCurrent(conversationIdBefore, workspacePath)
      ) {
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
    const conversationId = chatStore.activeThreadId
    const requestId = ++planRefreshRequestId
    if (!conversationId) {
      planEntries.value = []
      return
    }

    try {
      const result = (await workspacePresenter.getPlanEntries(conversationId)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (isPlanRefreshCurrent(conversationId, requestId)) {
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
    expandedSnippetIds.value = new Set()
    lastSyncedConversationId.value = null
    lastSuccessfulWorkspace.value = null
    isLoading.value = false
    if (fileRefreshDebounceTimer) {
      clearTimeout(fileRefreshDebounceTimer)
      fileRefreshDebounceTimer = null
    }
  }

  const getSnippetTime = (snippet: WorkspaceTerminalSnippet, key: 'startedAt' | 'endedAt') =>
    snippet[key] ?? snippet.timestamp

  const trimTerminalSnippets = (snippets: WorkspaceTerminalSnippet[]) => {
    const running = snippets
      .filter((snippet) => snippet.status === 'running')
      .sort((a, b) => getSnippetTime(b, 'startedAt') - getSnippetTime(a, 'startedAt'))

    const completed = snippets
      .filter((snippet) => snippet.status !== 'running')
      .sort((a, b) => getSnippetTime(b, 'endedAt') - getSnippetTime(a, 'endedAt'))

    return [...running, ...completed.slice(0, 3)]
  }

  const upsertTerminalSnippet = (snippet: WorkspaceTerminalSnippet) => {
    if (snippet.status === 'aborted') {
      removeTerminalSnippet(snippet.id)
      return
    }
    const existingIndex = terminalSnippets.value.findIndex((item) => item.id === snippet.id)
    if (existingIndex >= 0) {
      terminalSnippets.value[existingIndex] = {
        ...terminalSnippets.value[existingIndex],
        ...snippet
      }
    } else {
      terminalSnippets.value = [snippet, ...terminalSnippets.value]
    }
    terminalSnippets.value = trimTerminalSnippets(terminalSnippets.value)
  }

  const toggleSnippetExpansion = (snippetId: string) => {
    const next = new Set(expandedSnippetIds.value)
    if (next.has(snippetId)) {
      next.delete(snippetId)
    } else {
      next.add(snippetId)
    }
    expandedSnippetIds.value = next
  }

  const removeTerminalSnippet = (snippetId: string) => {
    terminalSnippets.value = terminalSnippets.value.filter((snippet) => snippet.id !== snippetId)
    const next = new Set(expandedSnippetIds.value)
    next.delete(snippetId)
    expandedSnippetIds.value = next
  }

  const terminateCommand = async (snippetId: string) => {
    const conversationId = chatStore.activeThreadId
    if (!conversationId) {
      console.warn('[Workspace] No active conversation, cannot terminate command')
      return
    }

    try {
      await workspacePresenter.terminateCommand(conversationId, snippetId)
      removeTerminalSnippet(snippetId)
    } catch (error) {
      console.error('[Workspace] Failed to terminate command:', error)
    }
  }

  const terminateAllRunningCommands = async () => {
    const conversationId = chatStore.activeThreadId
    if (!conversationId) return

    const runningSnippets = terminalSnippets.value.filter((snippet) => snippet.status === 'running')
    if (runningSnippets.length === 0) return

    try {
      await Promise.all(runningSnippets.map((snippet) => terminateCommand(snippet.id)))
    } catch (error) {
      console.error('[Workspace] Failed to terminate one or more commands:', error)
    }
  }

  // === Event Listeners ===
  const handlePlanUpdated = (
    _: unknown,
    payload: { conversationId: string; entries: WorkspacePlanEntry[] }
  ) => {
    if (payload.conversationId === chatStore.activeThreadId) {
      planEntries.value = payload.entries
    }
  }

  const handleTerminalOutput = (
    _: unknown,
    payload: { conversationId: string; snippet: WorkspaceTerminalSnippet }
  ) => {
    if (payload.conversationId === chatStore.activeThreadId) {
      upsertTerminalSnippet(payload.snippet)
    }
  }

  const handleFilesChanged = (_: unknown, payload: { conversationId: string }) => {
    if (payload.conversationId === chatStore.activeThreadId && isAgentMode.value) {
      debouncedRefreshFileTree()
    }
  }

  const bindEventListeners = () => {
    if (!ipcRenderer || listenersBound) {
      return () => undefined
    }

    // Plan update event
    ipcRenderer.on(WORKSPACE_EVENTS.PLAN_UPDATED, handlePlanUpdated)

    // Terminal output event
    ipcRenderer.on(WORKSPACE_EVENTS.TERMINAL_OUTPUT, handleTerminalOutput)

    // File change event - refresh file tree (debounced to merge rapid updates)
    ipcRenderer.on(WORKSPACE_EVENTS.FILES_CHANGED, handleFilesChanged)

    listenersBound = true

    return () => {
      ipcRenderer.removeListener(WORKSPACE_EVENTS.PLAN_UPDATED, handlePlanUpdated)
      ipcRenderer.removeListener(WORKSPACE_EVENTS.TERMINAL_OUTPUT, handleTerminalOutput)
      ipcRenderer.removeListener(WORKSPACE_EVENTS.FILES_CHANGED, handleFilesChanged)
      if (fileRefreshDebounceTimer) {
        clearTimeout(fileRefreshDebounceTimer)
        fileRefreshDebounceTimer = null
      }
      listenersBound = false
    }
  }

  // === Watchers ===
  if (deps.enableWatchers !== false) {
    // Watch for conversation changes
    watch(
      () => chatStore.activeThreadId,
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
  }

  return {
    // State
    isOpen,
    isLoading,
    planEntries,
    fileTree,
    terminalSnippets,
    expandedSnippetIds,
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
    clearData,
    toggleSnippetExpansion,
    removeTerminalSnippet,
    terminateCommand,
    terminateAllRunningCommands,
    bindEventListeners
  }
}

export const useWorkspaceStore = defineStore('workspace', () => createWorkspaceStore())
