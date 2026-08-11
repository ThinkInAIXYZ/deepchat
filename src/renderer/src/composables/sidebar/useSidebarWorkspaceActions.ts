import { computed, nextTick, ref, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { tryOnScopeDispose, usePreferredReducedMotion, useTimeoutFn } from '@vueuse/core'
import type { EnvironmentSummary } from '@shared/types/agent-interface'
import { normalizeWorkspacePath } from '@shared/utils/filesystem'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import type { useProjectStore } from '@/stores/ui/project'
import type { SessionGroup, useSessionStore } from '@/stores/ui/session'
import { CHAT_SECTION_GROUP_ID } from './useSidebarWorkspaceGroups'

const WORKSPACE_REVEAL_HIGHLIGHT_MS = 900

type WorkspaceArchiveTarget = Pick<EnvironmentSummary, 'path' | 'name'>

interface UseSidebarWorkspaceActionsOptions {
  sessionStore: ReturnType<typeof useSessionStore>
  projectStore: ReturnType<typeof useProjectStore>
  sessionListRef: Ref<HTMLElement | null>
  searchQuery: Ref<string>
  defaultChatWorkspacePath: MaybeRefOrGetter<string>
  getWorkspaceEnvironment: (group: SessionGroup) => EnvironmentSummary | undefined
  t: (key: string, values?: Record<string, unknown>) => string
}

/**
 * Workspace management actions surfaced in the sidebar: registering a directory via the
 * folder picker (with a scroll-into-view highlight on the new group) and archiving an
 * active workspace behind a confirm dialog.
 */
export function useSidebarWorkspaceActions(options: UseSidebarWorkspaceActionsOptions) {
  const { sessionStore, projectStore, sessionListRef, t } = options

  const isAddingWorkspace = ref(false)
  const revealedWorkspaceGroupId = ref<string | null>(null)
  const archiveTargetWorkspace = ref<WorkspaceArchiveTarget | null>(null)
  const isArchivingWorkspace = ref(false)

  const archiveWorkspaceDialogOpen = computed({
    get: () => archiveTargetWorkspace.value !== null,
    set: (open: boolean) => {
      if (!open && !isArchivingWorkspace.value) {
        archiveTargetWorkspace.value = null
      }
    }
  })

  const reducedMotion = usePreferredReducedMotion()
  const revealHighlightTimeout = useTimeoutFn(
    () => {
      revealedWorkspaceGroupId.value = null
    },
    WORKSPACE_REVEAL_HIGHLIGHT_MS,
    { immediate: false }
  )

  const revealWorkspaceGroup = async (projectPath: string) => {
    await nextTick()
    const pathIdentity = normalizeWorkspacePath(projectPath)
    const isChatWorkspace = pathIdentity === toValue(options.defaultChatWorkspacePath)
    const groupId = isChatWorkspace ? CHAT_SECTION_GROUP_ID : pathIdentity
    const groupTarget = Array.from(
      sessionListRef.value?.querySelectorAll<HTMLElement>('[data-group-id]') ?? []
    ).find((element) => element.dataset.groupId === groupId)
    const target =
      groupTarget ??
      (isChatWorkspace
        ? sessionListRef.value
            ?.closest<HTMLElement>('[data-testid="window-sidebar"]')
            ?.querySelector<HTMLElement>('[data-testid="app-new-chat-button"]')
        : null)

    target?.scrollIntoView?.({ block: 'nearest' })
    target?.focus()
    if (target && reducedMotion.value !== 'reduce') {
      revealHighlightTimeout.stop()
      revealedWorkspaceGroupId.value = groupId
      revealHighlightTimeout.start()
    }
  }

  const handleAddWorkspace = async () => {
    if (isAddingWorkspace.value) {
      return
    }

    isAddingWorkspace.value = true
    try {
      const selectedPath = await projectStore.openFolderPicker({ select: false })
      if (!selectedPath) {
        return
      }

      options.searchQuery.value = ''
      await sessionStore.setGroupMode('project')
      await revealWorkspaceGroup(selectedPath)
    } catch (error) {
      console.warn('[WindowSideBar] Failed to add workspace:', error)
      notifyRenderer({
        kind: 'error',
        code: 'chat.workspace.registrationFailed',
        title: t('common.error.operationFailed'),
        description: t('chat.sidebar.addWorkspaceFailed')
      })
    } finally {
      isAddingWorkspace.value = false
    }
  }

  const requestWorkspaceArchive = (group: SessionGroup) => {
    const environment = options.getWorkspaceEnvironment(group)
    if (environment?.status !== 'active' || isArchivingWorkspace.value) {
      return
    }

    archiveTargetWorkspace.value = {
      path: environment.path,
      name: environment.name
    }
  }

  const handleArchiveWorkspaceConfirm = async () => {
    const target = archiveTargetWorkspace.value
    if (!target || isArchivingWorkspace.value) {
      return
    }

    isArchivingWorkspace.value = true
    try {
      await projectStore.archiveEnvironment(target.path)
      archiveTargetWorkspace.value = null
    } catch (error) {
      console.warn('[WindowSideBar] Failed to archive workspace:', error)
      notifyRenderer({
        kind: 'error',
        code: 'chat.workspace.archive.failed',
        title: t('settings.environments.errors.archiveTitle')
      })
    } finally {
      isArchivingWorkspace.value = false
    }
  }

  tryOnScopeDispose(() => {
    revealedWorkspaceGroupId.value = null
  })

  return {
    isAddingWorkspace,
    revealedWorkspaceGroupId,
    archiveTargetWorkspace,
    isArchivingWorkspace,
    archiveWorkspaceDialogOpen,
    handleAddWorkspace,
    requestWorkspaceArchive,
    handleArchiveWorkspaceConfirm
  }
}
