import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { WORKSPACE_EVENTS } from '@/events'
import type {
  IWorkspacePresenter,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceGitDiff,
  WorkspaceGitState,
  WorkspaceInvalidationEvent,
  WorkspaceInvalidationKind
} from '@shared/presenter'
import type { WorkspaceSessionState } from '@/stores/ui/sidepanel'

type WorkspaceEventCompatPayload = WorkspaceInvalidationEvent & {
  conversationId?: string
}

interface UseWorkspaceSyncOptions {
  sessionId: Ref<string>
  workspacePath: Ref<string | null>
  active: ComputedRef<boolean>
  sessionState: ComputedRef<WorkspaceSessionState>
  workspacePresenter: IWorkspacePresenter
  sidepanelStore: {
    clearFile(sessionId: string): void
    clearDiff(sessionId: string): void
  }
}

const REFRESH_DEBOUNCE_MS = 120

const normalizeWorkspaceKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  return value
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
}

const isInvalidationKind = (value: unknown): value is WorkspaceInvalidationKind => {
  return value === 'fs' || value === 'git' || value === 'full'
}

const collectExpandedDirectories = (
  nodes: WorkspaceFileNode[],
  output: Set<string> = new Set<string>()
): Set<string> => {
  for (const node of nodes) {
    if (!node.isDirectory || !node.expanded) {
      continue
    }

    const key = normalizeWorkspaceKey(node.path)
    if (key) {
      output.add(key)
    }

    if (node.children?.length) {
      collectExpandedDirectories(node.children, output)
    }
  }

  return output
}

export function useWorkspaceSync(options: UseWorkspaceSyncOptions) {
  const fileTree = ref<WorkspaceFileNode[]>([])
  const selectedFilePreview = ref<WorkspaceFilePreview | null>(null)
  const selectedGitDiff = ref<WorkspaceGitDiff | null>(null)
  const gitState = ref<WorkspaceGitState | null>(null)
  const loadingFiles = ref(false)
  const loadingFilePreview = ref(false)
  const loadingGitDiff = ref(false)

  const normalizedWorkspacePath = computed(() =>
    normalizeWorkspaceKey(options.workspacePath.value?.trim() || null)
  )

  let watchedWorkspacePath: string | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let pendingKind: WorkspaceInvalidationKind | null = null
  let syncRequestId = 0
  let previewRequestId = 0
  let diffRequestId = 0

  const isCurrentRequest = (requestId: number, workspacePath: string): boolean => {
    return (
      requestId === syncRequestId &&
      options.active.value &&
      normalizeWorkspaceKey(options.workspacePath.value) === normalizeWorkspaceKey(workspacePath)
    )
  }

  const hasGitChange = (state: WorkspaceGitState | null, filePath: string): boolean => {
    const normalizedFilePath = normalizeWorkspaceKey(filePath)
    if (!state || !normalizedFilePath) {
      return false
    }

    return state.changes.some((change) => normalizeWorkspaceKey(change.path) === normalizedFilePath)
  }

  const refreshSelectedPreview = async (clearIfMissing: boolean): Promise<void> => {
    const filePath = options.sessionState.value.selectedFilePath
    if (!filePath) {
      selectedFilePreview.value = null
      return
    }

    if (!options.active.value) {
      return
    }

    const requestId = ++previewRequestId
    loadingFilePreview.value = true

    try {
      const preview = await options.workspacePresenter.readFilePreview(filePath)
      if (requestId !== previewRequestId) {
        return
      }

      selectedFilePreview.value = preview
      if (!preview && clearIfMissing) {
        options.sidepanelStore.clearFile(options.sessionId.value)
      }
    } finally {
      if (requestId === previewRequestId) {
        loadingFilePreview.value = false
      }
    }
  }

  const refreshSelectedDiff = async (
    clearIfMissing: boolean,
    stateOverride?: WorkspaceGitState | null
  ): Promise<void> => {
    const filePath = options.sessionState.value.selectedDiffPath
    if (!filePath) {
      selectedGitDiff.value = null
      return
    }

    if (!options.active.value) {
      return
    }

    const activeWorkspacePath = options.workspacePath.value
    if (!activeWorkspacePath) {
      selectedGitDiff.value = null
      if (clearIfMissing) {
        options.sidepanelStore.clearDiff(options.sessionId.value)
      }
      return
    }

    const currentGitState = stateOverride ?? gitState.value
    if (clearIfMissing && !hasGitChange(currentGitState, filePath)) {
      selectedGitDiff.value = null
      options.sidepanelStore.clearDiff(options.sessionId.value)
      return
    }

    const requestId = ++diffRequestId
    loadingGitDiff.value = true

    try {
      const diff = await options.workspacePresenter.getGitDiff(activeWorkspacePath, filePath)
      if (requestId !== diffRequestId) {
        return
      }

      selectedGitDiff.value = diff
      if (!diff && clearIfMissing) {
        options.sidepanelStore.clearDiff(options.sessionId.value)
      }
    } finally {
      if (requestId === diffRequestId) {
        loadingGitDiff.value = false
      }
    }
  }

  const restoreExpandedDirectories = async (
    nodes: WorkspaceFileNode[],
    expandedDirectories: Set<string>,
    requestId: number,
    workspacePath: string
  ): Promise<void> => {
    for (const node of nodes) {
      if (!node.isDirectory) {
        continue
      }

      const key = normalizeWorkspaceKey(node.path)
      if (!key || !expandedDirectories.has(key)) {
        node.expanded = false
        continue
      }

      const children = (await options.workspacePresenter.expandDirectory(node.path)) ?? []
      if (!isCurrentRequest(requestId, workspacePath)) {
        return
      }

      node.children = children
      node.expanded = true
      await restoreExpandedDirectories(children, expandedDirectories, requestId, workspacePath)
      if (!isCurrentRequest(requestId, workspacePath)) {
        return
      }
    }
  }

  const refreshWorkspace = async (kind: WorkspaceInvalidationKind): Promise<void> => {
    const workspacePath = options.workspacePath.value?.trim() || null
    if (!workspacePath || !options.active.value) {
      return
    }

    const requestId = ++syncRequestId
    if (kind !== 'git') {
      loadingFiles.value = true
    }

    try {
      if (kind !== 'git') {
        const expandedDirectories = collectExpandedDirectories(fileTree.value)
        const nextTree = (await options.workspacePresenter.readDirectory(workspacePath)) ?? []
        if (!isCurrentRequest(requestId, workspacePath)) {
          return
        }

        await restoreExpandedDirectories(nextTree, expandedDirectories, requestId, workspacePath)
        if (!isCurrentRequest(requestId, workspacePath)) {
          return
        }

        fileTree.value = nextTree
      }

      const nextGitState = await options.workspacePresenter.getGitStatus(workspacePath)
      if (!isCurrentRequest(requestId, workspacePath)) {
        return
      }

      gitState.value = nextGitState

      if (kind !== 'git') {
        await refreshSelectedPreview(true)
      }

      await refreshSelectedDiff(true, nextGitState)
    } finally {
      if (kind !== 'git' && isCurrentRequest(requestId, workspacePath)) {
        loadingFiles.value = false
      }
    }
  }

  const scheduleRefresh = (kind: WorkspaceInvalidationKind): void => {
    if (!options.active.value) {
      return
    }

    if (
      !pendingKind ||
      (pendingKind === 'git' && kind !== 'git') ||
      (pendingKind === 'fs' && kind === 'full')
    ) {
      pendingKind = kind
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    refreshTimer = setTimeout(() => {
      const nextKind = pendingKind ?? kind
      refreshTimer = null
      pendingKind = null
      void refreshWorkspace(nextKind)
    }, REFRESH_DEBOUNCE_MS)
  }

  const handleWorkspaceInvalidated = (_event: unknown, payload: unknown) => {
    const activeWorkspacePath = normalizedWorkspacePath.value
    if (!activeWorkspacePath) {
      return
    }

    if (!payload || typeof payload !== 'object') {
      return
    }

    const eventPayload = payload as Partial<WorkspaceEventCompatPayload>
    const payloadWorkspacePath = normalizeWorkspaceKey(eventPayload.workspacePath)
    const matchesWorkspace =
      payloadWorkspacePath !== null && payloadWorkspacePath === activeWorkspacePath
    const matchesConversation =
      typeof eventPayload.conversationId === 'string' &&
      eventPayload.conversationId === options.sessionId.value

    if (!matchesWorkspace && !matchesConversation) {
      return
    }

    const kind = isInvalidationKind(eventPayload.kind) ? eventPayload.kind : 'full'
    scheduleRefresh(kind)
  }

  const ensureWatcherState = async (
    workspacePath: string | null,
    active: boolean
  ): Promise<void> => {
    const nextWorkspacePath = active ? workspacePath?.trim() || null : null
    const previousWorkspacePath = watchedWorkspacePath

    if (previousWorkspacePath && previousWorkspacePath !== nextWorkspacePath) {
      watchedWorkspacePath = null
      await options.workspacePresenter.unwatchWorkspace(previousWorkspacePath)
    }

    if (!nextWorkspacePath) {
      if (!workspacePath) {
        fileTree.value = []
        gitState.value = null
        selectedFilePreview.value = null
        selectedGitDiff.value = null
      }
      return
    }

    if (watchedWorkspacePath !== nextWorkspacePath) {
      await options.workspacePresenter.registerWorkspace(nextWorkspacePath)
      await options.workspacePresenter.watchWorkspace(nextWorkspacePath)
      watchedWorkspacePath = nextWorkspacePath
    }

    await refreshWorkspace('full')
  }

  const toggleNode = async (node: WorkspaceFileNode) => {
    if (!node.isDirectory) {
      return
    }

    if (node.expanded) {
      node.expanded = false
      return
    }

    if (!node.children) {
      node.children = (await options.workspacePresenter.expandDirectory(node.path)) ?? []
    }

    node.expanded = true
  }

  watch(
    [options.workspacePath, options.active] as const,
    ([workspacePath, active]) => {
      void ensureWatcherState(workspacePath, active)
    },
    { immediate: true }
  )

  watch(
    () => options.sessionState.value.selectedFilePath,
    () => {
      void refreshSelectedPreview(false)
    },
    { immediate: true }
  )

  watch(
    () => options.sessionState.value.selectedDiffPath,
    () => {
      void refreshSelectedDiff(false)
    },
    { immediate: true }
  )

  onMounted(() => {
    window.electron.ipcRenderer.on(WORKSPACE_EVENTS.INVALIDATED, handleWorkspaceInvalidated)
  })

  onBeforeUnmount(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    window.electron.ipcRenderer.removeListener(
      WORKSPACE_EVENTS.INVALIDATED,
      handleWorkspaceInvalidated
    )

    if (watchedWorkspacePath) {
      const workspacePath = watchedWorkspacePath
      watchedWorkspacePath = null
      void options.workspacePresenter.unwatchWorkspace(workspacePath)
    }
  })

  return {
    fileTree,
    selectedFilePreview,
    selectedGitDiff,
    gitState,
    loadingFiles,
    loadingFilePreview,
    loadingGitDiff,
    toggleNode
  }
}
