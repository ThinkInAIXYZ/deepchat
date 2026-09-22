import { computed, type ComputedRef } from 'vue'
import type { WorkspaceFilePreview, WorkspaceViewMode } from '@shared/types/workspace'

export type WorkspaceViewerSource = 'file' | 'git-diff' | null
export type WorkspaceViewerPane = 'empty' | 'git-diff' | 'code' | 'preview' | 'info'
export type WorkspacePreviewKind = 'markdown' | 'html' | 'pdf' | 'svg' | 'image' | 'raw'

type SessionStateLike = {
  selectedFilePath: string | null
  selectedDiffPath: string | null
  viewMode: WorkspaceViewMode
}

interface UseWorkspaceViewerModelOptions {
  filePreview: ComputedRef<WorkspaceFilePreview | null>
  sessionState: ComputedRef<SessionStateLike>
}

export function useWorkspaceViewerModel(options: UseWorkspaceViewerModelOptions) {
  const activeSource = computed<WorkspaceViewerSource>(() => {
    if (options.sessionState.value.selectedDiffPath) {
      return 'git-diff'
    }
    if (options.sessionState.value.selectedFilePath) {
      return 'file'
    }
    return null
  })

  const filePreviewKind = computed<WorkspacePreviewKind | null>(() => {
    switch (options.filePreview.value?.kind) {
      case 'markdown':
        return 'markdown'
      case 'html':
        return 'html'
      case 'pdf':
        return 'pdf'
      case 'svg':
        return 'svg'
      case 'image':
        return 'image'
      default:
        return null
    }
  })

  const availableTabs = computed<WorkspaceViewMode[]>(() => {
    if (activeSource.value !== 'file' || !options.filePreview.value) {
      return []
    }

    switch (options.filePreview.value.kind) {
      case 'markdown':
      case 'html':
      case 'svg':
        return ['preview', 'code']
      case 'text':
        return ['code']
      case 'pdf':
        return ['preview']
      default:
        return []
    }
  })

  const effectiveViewMode = computed<WorkspaceViewMode>(() => {
    if (availableTabs.value.includes(options.sessionState.value.viewMode)) {
      return options.sessionState.value.viewMode
    }

    return availableTabs.value[0] ?? 'preview'
  })

  const paneKind = computed<WorkspaceViewerPane>(() => {
    if (activeSource.value === null) {
      return 'empty'
    }

    if (activeSource.value === 'git-diff') {
      return 'git-diff'
    }

    if (!options.filePreview.value) {
      return 'empty'
    }

    switch (options.filePreview.value.kind) {
      case 'text':
        return 'code'
      case 'markdown':
      case 'html':
      case 'pdf':
      case 'svg':
      case 'image':
        return effectiveViewMode.value === 'code' ? 'code' : 'preview'
      case 'binary':
      default:
        return 'info'
    }
  })

  const previewKind = computed<WorkspacePreviewKind | null>(() => {
    if (paneKind.value !== 'preview') {
      return null
    }

    return filePreviewKind.value
  })

  const shouldShowTabs = computed(() => availableTabs.value.length > 1)

  return {
    activeSource,
    availableTabs,
    effectiveViewMode,
    paneKind,
    previewKind,
    shouldShowTabs
  }
}
