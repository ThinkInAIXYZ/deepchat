import { computed, nextTick, ref, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { tryOnScopeDispose } from '@vueuse/core'
import type { useProjectStore } from '@/stores/ui/project'
import type { SessionGroup, useSessionStore } from '@/stores/ui/session'
import type { SidebarWorkspaceGroup } from './useSidebarWorkspaceGroups'
import { restoreSessionListScrollTop } from './useSessionListAutoFill'

export type ProjectGroupMoveTarget = 'top' | 'up' | 'down' | 'bottom'

interface UseProjectGroupReorderOptions {
  sessionStore: ReturnType<typeof useSessionStore>
  projectStore: ReturnType<typeof useProjectStore>
  sessionListRef: Ref<HTMLElement | null>
  collapsed: MaybeRefOrGetter<boolean>
  normalizedSearchQuery: MaybeRefOrGetter<string>
  pinFlightSessionId: MaybeRefOrGetter<string | null>
  workspaceGroups: MaybeRefOrGetter<SidebarWorkspaceGroup[]>
  /** Shared drag flag owned by the component so sibling composables can pause on it. */
  isProjectGroupDragging: Ref<boolean>
  isActiveProjectDirectoryGroup: (group: SessionGroup) => boolean
  getGroupIdentifier: (group: SessionGroup) => string
  getWorkspacePath: (group: SessionGroup) => string
  ensureSessionListFilled: () => Promise<void>
  onDragStart?: () => void
}

/**
 * Drag-and-drop plus menu-based reordering for active workspace groups. Reorders are
 * committed to the project store as a full environment order, preserving hidden
 * environments in their current slots.
 */
export function useProjectGroupReorder(options: UseProjectGroupReorderOptions) {
  const { sessionStore, projectStore, sessionListRef, isProjectGroupDragging } = options

  const projectGroupDragScrollTop = ref<number | null>(null)

  const projectReorderableGroups = computed(() =>
    toValue(options.workspaceGroups).filter(options.isActiveProjectDirectoryGroup)
  )
  const canReorderProjectGroups = computed(
    () =>
      !toValue(options.collapsed) &&
      sessionStore.groupMode === 'project' &&
      toValue(options.normalizedSearchQuery).length === 0 &&
      !toValue(options.pinFlightSessionId) &&
      projectStore.snapshotReady &&
      sessionStore.hasLoadedInitialPage &&
      !sessionStore.loading &&
      projectReorderableGroups.value.length > 1
  )

  const isProjectGroupReorderTarget = (group: SessionGroup) =>
    options.isActiveProjectDirectoryGroup(group)

  const getCurrentProjectOrderPaths = () => {
    const environmentPaths = projectStore.environments.map((environment) => environment.path)
    return environmentPaths.length > 0
      ? environmentPaths
      : projectReorderableGroups.value.map(options.getWorkspacePath)
  }

  const commitVisibleProjectGroupOrder = async (nextVisiblePaths: string[]) => {
    const currentOrder = getCurrentProjectOrderPaths()
    const previousVisiblePaths = projectReorderableGroups.value.map(options.getWorkspacePath)
    const previousVisiblePathSet = new Set(previousVisiblePaths)
    const nextVisiblePathSet = new Set(nextVisiblePaths)
    const isPermutationOfVisiblePaths =
      nextVisiblePaths.length === previousVisiblePaths.length &&
      previousVisiblePathSet.size === previousVisiblePaths.length &&
      nextVisiblePathSet.size === nextVisiblePaths.length &&
      nextVisiblePaths.every((path) => previousVisiblePathSet.has(path))
    if (!isPermutationOfVisiblePaths) {
      console.warn('[WindowSideBar] Skipping project group reorder: visible group mismatch')
      return
    }
    const nextOrder = [...currentOrder]
    let nextVisibleIndex = 0

    for (let index = 0; index < nextOrder.length; index += 1) {
      if (!previousVisiblePathSet.has(nextOrder[index])) {
        continue
      }

      const nextPath = nextVisiblePaths[nextVisibleIndex]
      if (nextPath) {
        nextOrder[index] = nextPath
      }
      nextVisibleIndex += 1
    }

    for (const path of nextVisiblePaths) {
      if (!nextOrder.includes(path)) {
        nextOrder.push(path)
      }
    }

    await projectStore.reorderEnvironments(nextOrder)
  }

  const handleProjectGroupModelUpdate = (nextGroups: SessionGroup[]) => {
    if (!canReorderProjectGroups.value) {
      return
    }

    const nextVisiblePaths = nextGroups
      .filter(options.isActiveProjectDirectoryGroup)
      .map(options.getWorkspacePath)
    void commitVisibleProjectGroupOrder(nextVisiblePaths).catch((error) => {
      console.warn('[WindowSideBar] Failed to reorder project groups:', error)
    })
  }

  const canMoveProjectGroup = (group: SessionGroup, delta: -1 | 1) => {
    if (!canReorderProjectGroups.value || !isProjectGroupReorderTarget(group)) {
      return false
    }

    const groups = projectReorderableGroups.value
    const index = groups.findIndex(
      (candidate) => options.getGroupIdentifier(candidate) === options.getGroupIdentifier(group)
    )
    if (index < 0) {
      return false
    }

    return delta < 0 ? index > 0 : index < groups.length - 1
  }

  const handleMoveProjectGroup = (group: SessionGroup, target: ProjectGroupMoveTarget) => {
    if (!canReorderProjectGroups.value || !isProjectGroupReorderTarget(group)) {
      return
    }

    const paths = projectReorderableGroups.value.map(options.getWorkspacePath)
    const currentIndex = paths.indexOf(options.getWorkspacePath(group))
    if (currentIndex < 0) {
      return
    }

    const [path] = paths.splice(currentIndex, 1)
    const nextIndex =
      target === 'top'
        ? 0
        : target === 'bottom'
          ? paths.length
          : target === 'up'
            ? Math.max(0, currentIndex - 1)
            : Math.min(paths.length, currentIndex + 1)

    paths.splice(nextIndex, 0, path)
    void commitVisibleProjectGroupOrder(paths).catch((error) => {
      console.warn('[WindowSideBar] Failed to move project group:', error)
    })
  }

  const handleProjectGroupDragStart = () => {
    isProjectGroupDragging.value = true
    projectGroupDragScrollTop.value = sessionListRef.value?.scrollTop ?? null
    options.onDragStart?.()
  }

  const handleProjectGroupDragEnd = () => {
    void nextTick(() => {
      restoreSessionListScrollTop(sessionListRef.value, projectGroupDragScrollTop.value)
      projectGroupDragScrollTop.value = null
      isProjectGroupDragging.value = false
      void options.ensureSessionListFilled()
    })
  }

  tryOnScopeDispose(() => {
    isProjectGroupDragging.value = false
    projectGroupDragScrollTop.value = null
  })

  return {
    projectReorderableGroups,
    canReorderProjectGroups,
    isProjectGroupReorderTarget,
    handleProjectGroupModelUpdate,
    canMoveProjectGroup,
    handleMoveProjectGroup,
    handleProjectGroupDragStart,
    handleProjectGroupDragEnd
  }
}
