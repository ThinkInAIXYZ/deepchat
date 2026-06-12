import { computed, onScopeDispose, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import type { SidePanelTab, WorkspaceNavSection, WorkspaceViewMode } from '@shared/presenter'

export interface WorkspaceArtifactContext {
  threadId: string
  messageId: string
  artifactId: string
}

export interface WorkspaceSessionState {
  selectedArtifactContext: WorkspaceArtifactContext | null
  selectedFilePath: string | null
  selectedDiffPath: string | null
  viewMode: WorkspaceViewMode
  sections: Record<WorkspaceNavSection, boolean>
}

const createSessionState = (): WorkspaceSessionState => ({
  selectedArtifactContext: null,
  selectedFilePath: null,
  selectedDiffPath: null,
  viewMode: 'preview',
  sections: {
    artifacts: true,
    files: true,
    git: false,
    subagents: true
  }
})

export const useSidepanelStore = defineStore('sidepanel', () => {
  const viewportWidth = ref(typeof window === 'undefined' ? 1548 : window.innerWidth)

  const resolveMaxWidth = () => {
    return Math.min(960, Math.round(viewportWidth.value * 0.62))
  }

  const clampWidth = (nextWidth: number) => {
    const maxWidth = resolveMaxWidth()
    const minWidth = Math.min(420, maxWidth)
    const widthValue = Number(nextWidth)
    if (!Number.isFinite(widthValue)) {
      return Math.min(maxWidth, Math.max(minWidth, 520))
    }
    return Math.min(maxWidth, Math.max(minWidth, Math.round(widthValue)))
  }

  const open = ref(false)
  const activeTab = ref<SidePanelTab>('workspace')
  const width = useStorage('chat-sidepanel-width', 520)
  const sessionStates = reactive<Record<string, WorkspaceSessionState>>({})

  const normalizedWidth = computed(() => {
    return clampWidth(Number(width.value))
  })

  const NAV_MIN_WIDTH = 160
  const NAV_MAX_WIDTH = 360
  const NAV_DEFAULT_WIDTH = 200

  const clampNavWidth = (nextWidth: number) => {
    const widthValue = Number(nextWidth)
    if (!Number.isFinite(widthValue)) {
      return NAV_DEFAULT_WIDTH
    }
    return Math.min(NAV_MAX_WIDTH, Math.max(NAV_MIN_WIDTH, Math.round(widthValue)))
  }

  const navCollapsed = useStorage('workspace-nav-collapsed', false)
  const navWidthStorage = useStorage('workspace-nav-width', NAV_DEFAULT_WIDTH)

  const navWidth = computed(() => clampNavWidth(Number(navWidthStorage.value)))

  const setNavWidth = (nextWidth: number) => {
    navWidthStorage.value = clampNavWidth(nextWidth)
  }

  const setNavCollapsed = (collapsed: boolean) => {
    navCollapsed.value = collapsed
  }

  const toggleNavCollapsed = () => {
    navCollapsed.value = !navCollapsed.value
  }

  if (typeof window !== 'undefined') {
    const handleResize = () => {
      viewportWidth.value = window.innerWidth
      width.value = clampWidth(Number(width.value))
    }

    window.addEventListener('resize', handleResize)
    onScopeDispose(() => window.removeEventListener('resize', handleResize))
  }

  const ensureSessionState = (sessionId: string): WorkspaceSessionState => {
    if (!sessionStates[sessionId]) {
      sessionStates[sessionId] = createSessionState()
    }
    return sessionStates[sessionId]
  }

  const getSessionState = (sessionId: string | null | undefined): WorkspaceSessionState => {
    if (!sessionId) {
      return createSessionState()
    }
    return ensureSessionState(sessionId)
  }

  const setWidth = (nextWidth: number) => {
    width.value = clampWidth(nextWidth)
  }

  const openWorkspace = (sessionId?: string | null) => {
    if (sessionId) {
      ensureSessionState(sessionId)
    }
    open.value = true
    activeTab.value = 'workspace'
  }

  const openBrowser = () => {
    open.value = true
    activeTab.value = 'browser'
  }

  const closePanel = () => {
    open.value = false
  }

  const toggleWorkspace = (sessionId?: string | null) => {
    if (open.value && activeTab.value === 'workspace') {
      open.value = false
      return
    }
    openWorkspace(sessionId)
  }

  const setViewMode = (sessionId: string, mode: WorkspaceViewMode) => {
    ensureSessionState(sessionId).viewMode = mode
  }

  const toggleSection = (sessionId: string, section: WorkspaceNavSection) => {
    const state = ensureSessionState(sessionId)
    state.sections[section] = !state.sections[section]
  }

  const selectArtifact = (
    sessionId: string,
    context: WorkspaceArtifactContext | null,
    options?: {
      open?: boolean
      viewMode?: WorkspaceViewMode
    }
  ) => {
    const state = ensureSessionState(sessionId)
    state.selectedArtifactContext = context
    state.selectedFilePath = null
    state.selectedDiffPath = null
    state.viewMode = options?.viewMode ?? state.viewMode
    state.sections.artifacts = true

    if (options?.open !== false) {
      openWorkspace(sessionId)
    }
  }

  const selectFile = (
    sessionId: string,
    filePath: string,
    options?: {
      open?: boolean
      viewMode?: WorkspaceViewMode
    }
  ) => {
    const state = ensureSessionState(sessionId)
    state.selectedArtifactContext = null
    state.selectedFilePath = filePath
    state.selectedDiffPath = null
    state.viewMode = options?.viewMode ?? state.viewMode
    state.sections.files = true

    if (options?.open !== false) {
      openWorkspace(sessionId)
    }
  }

  const selectDiff = (
    sessionId: string,
    filePath: string,
    options?: {
      open?: boolean
    }
  ) => {
    const state = ensureSessionState(sessionId)
    state.selectedArtifactContext = null
    state.selectedFilePath = null
    state.selectedDiffPath = filePath
    state.sections.git = true

    if (options?.open !== false) {
      openWorkspace(sessionId)
    }
  }

  const clearArtifact = (sessionId: string) => {
    const state = ensureSessionState(sessionId)
    state.selectedArtifactContext = null
  }

  const clearFile = (sessionId: string) => {
    const state = ensureSessionState(sessionId)
    state.selectedFilePath = null
  }

  const clearDiff = (sessionId: string) => {
    const state = ensureSessionState(sessionId)
    state.selectedDiffPath = null
  }

  return {
    open,
    activeTab,
    width: normalizedWidth,
    navCollapsed,
    navWidth,
    setNavWidth,
    setNavCollapsed,
    toggleNavCollapsed,
    sessionStates,
    ensureSessionState,
    getSessionState,
    setWidth,
    openWorkspace,
    openBrowser,
    closePanel,
    toggleWorkspace,
    setViewMode,
    toggleSection,
    selectArtifact,
    selectFile,
    selectDiff,
    clearArtifact,
    clearFile,
    clearDiff
  }
})
