import { computed, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import {
  useWorkspaceAdapter,
  type WorkspaceAdapter,
  type WorkspaceFilesChangedPayload,
  type WorkspacePlanUpdatedPayload,
  type WorkspaceTerminalOutputPayload
} from '@/composables/workspace/useWorkspaceAdapter'
import type {
  WorkspaceFileNode,
  WorkspacePlanEntry,
  WorkspaceTerminalSnippet
} from '@shared/presenter'

const FILE_REFRESH_DEBOUNCE_MS = 500

export type WorkspaceStoreDeps = {
  chatStore?: ReturnType<typeof useChatStore>
  workspaceAdapter?: WorkspaceAdapter
  enableWatchers?: boolean
}

export const createWorkspaceStore = (deps: WorkspaceStoreDeps = {}) => {
  const chatStore = deps.chatStore ?? useChatStore()
  const workspaceAdapter = deps.workspaceAdapter ?? useWorkspaceAdapter()

  const isOpen = ref(false)
  const isLoading = ref(false)
  const planEntries = ref<WorkspacePlanEntry[]>([])
  const fileTree = ref<WorkspaceFileNode[]>([])
  const terminalSnippets = ref<WorkspaceTerminalSnippet[]>([])
  const expandedSnippetIds = ref<Set<string>>(new Set())
  const lastSyncedConversationId = ref<string | null>(null)
  const lastSuccessfulWorkspace = ref<string | null>(null)

  let fileRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let fileRefreshRequestId = 0
  let planRefreshRequestId = 0
  let listenersBound = false

  const currentWorkspacePath = computed(() => {
    // Workspace path now comes from conversation settings (Phase 6: chatConfig removed)
    return chatStore.activeThread?.settings?.agentWorkspacePath ?? null
  })

  const completedPlanCount = computed(
    () => planEntries.value.filter((entry) => entry.status === 'completed').length
  )

  const totalPlanCount = computed(() => planEntries.value.length)

  const planProgress = computed(() => {
    if (totalPlanCount.value === 0) return 0
    return Math.round((completedPlanCount.value / totalPlanCount.value) * 100)
  })

  const toggle = () => {
    isOpen.value = !isOpen.value
  }

  const setOpen = (open: boolean) => {
    isOpen.value = open
  }

  const isFileRefreshCurrent = (conversationId: string | null, workspacePath: string | null) => {
    if (!conversationId || !workspacePath) return false
    return (
      chatStore.activeSessionId === conversationId && currentWorkspacePath.value === workspacePath
    )
  }

  const isPlanRefreshCurrent = (conversationId: string | null, requestId: number) => {
    if (!conversationId) return false
    return requestId === planRefreshRequestId && chatStore.activeSessionId === conversationId
  }

  const refreshFileTree = async () => {
    const workspacePath = currentWorkspacePath.value
    const conversationIdBefore = chatStore.activeSessionId
    const requestId = ++fileRefreshRequestId

    if (!workspacePath || !conversationIdBefore) {
      fileTree.value = []
      isLoading.value = false
      return
    }

    // Always use registerWorkspace after ACP cleanup
    await workspaceAdapter.registerWorkspace(workspacePath)

    isLoading.value = true
    try {
      const result = (await workspaceAdapter.readDirectory(workspacePath)) ?? []
      if (
        requestId === fileRefreshRequestId &&
        isFileRefreshCurrent(conversationIdBefore, workspacePath)
      ) {
        fileTree.value = result
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

  const debouncedRefreshFileTree = () => {
    if (fileRefreshDebounceTimer) {
      clearTimeout(fileRefreshDebounceTimer)
    }
    fileRefreshDebounceTimer = setTimeout(() => {
      fileRefreshDebounceTimer = null
      void refreshFileTree()
    }, FILE_REFRESH_DEBOUNCE_MS)
  }

  const loadDirectoryChildren = async (node: WorkspaceFileNode): Promise<void> => {
    if (!node.isDirectory) return

    try {
      const children = (await workspaceAdapter.expandDirectory(node.path)) ?? []
      node.children = children
      node.expanded = true
    } catch (error) {
      console.error('[Workspace] Failed to load directory children:', error)
      node.children = []
      node.expanded = true
    }
  }

  const refreshPlanEntries = async () => {
    const conversationId = chatStore.activeSessionId
    const requestId = ++planRefreshRequestId
    if (!conversationId) {
      planEntries.value = []
      return
    }

    try {
      const result = (await workspaceAdapter.getPlanEntries(conversationId)) ?? []
      if (isPlanRefreshCurrent(conversationId, requestId)) {
        planEntries.value = result
      }
    } catch (error) {
      console.error('[Workspace] Failed to load plan entries:', error)
    }
  }

  const toggleFileNode = async (node: WorkspaceFileNode): Promise<void> => {
    if (!node.isDirectory) return

    if (node.expanded) {
      node.expanded = false
      return
    }

    if (node.children === undefined) {
      await loadDirectoryChildren(node)
      return
    }

    node.expanded = true
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
    const conversationId = chatStore.activeSessionId
    if (!conversationId) {
      console.warn('[Workspace] No active conversation, cannot terminate command')
      return
    }

    try {
      await workspaceAdapter.terminateCommand(conversationId, snippetId)
      removeTerminalSnippet(snippetId)
    } catch (error) {
      console.error('[Workspace] Failed to terminate command:', error)
    }
  }

  const terminateAllRunningCommands = async () => {
    const conversationId = chatStore.activeSessionId
    if (!conversationId) return

    const runningSnippets = terminalSnippets.value.filter((snippet) => snippet.status === 'running')
    if (runningSnippets.length === 0) return

    try {
      await Promise.all(runningSnippets.map((snippet) => terminateCommand(snippet.id)))
    } catch (error) {
      console.error('[Workspace] Failed to terminate one or more commands:', error)
    }
  }

  const handlePlanUpdated = (payload: WorkspacePlanUpdatedPayload) => {
    if (payload.conversationId === chatStore.activeSessionId) {
      planEntries.value = payload.entries
    }
  }

  const handleTerminalOutput = (payload: WorkspaceTerminalOutputPayload) => {
    if (payload.conversationId === chatStore.activeSessionId) {
      upsertTerminalSnippet(payload.snippet)
    }
  }

  const handleFilesChanged = (payload: WorkspaceFilesChangedPayload) => {
    if (payload.conversationId === chatStore.activeSessionId) {
      debouncedRefreshFileTree()
    }
  }

  const bindEventListeners = () => {
    if (listenersBound) {
      return () => undefined
    }

    const unsubscribers = [
      workspaceAdapter.onPlanUpdated(handlePlanUpdated),
      workspaceAdapter.onTerminalOutput(handleTerminalOutput),
      workspaceAdapter.onFilesChanged(handleFilesChanged)
    ]

    listenersBound = true

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      if (fileRefreshDebounceTimer) {
        clearTimeout(fileRefreshDebounceTimer)
        fileRefreshDebounceTimer = null
      }
      listenersBound = false
    }
  }

  if (deps.enableWatchers !== false) {
    watch(
      () => chatStore.activeSessionId,
      async (newId) => {
        if (newId !== lastSyncedConversationId.value) {
          lastSyncedConversationId.value = newId ?? null
          if (newId) {
            await Promise.all([refreshPlanEntries(), refreshFileTree()])
          } else {
            clearData()
          }
        }
      }
    )

    watch(
      currentWorkspacePath,
      (workspacePath, previousWorkspacePath) => {
        if (workspacePath !== previousWorkspacePath) {
          lastSuccessfulWorkspace.value = null
        }

        if (workspacePath) {
          void refreshFileTree()
        }
      },
      { immediate: true }
    )
  }

  return {
    isOpen,
    isLoading,
    planEntries,
    fileTree,
    terminalSnippets,
    expandedSnippetIds,
    currentWorkspacePath,
    completedPlanCount,
    totalPlanCount,
    planProgress,
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

export const useWorkspaceStoreService = () => createWorkspaceStore()
