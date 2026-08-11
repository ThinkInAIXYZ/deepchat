import { computed, ref, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
import type { EnvironmentSummary } from '@shared/types/agent-interface'
import { normalizeWorkspacePath } from '@shared/utils/filesystem'
import { disambiguateWorkspaceLabels } from '@shared/utils/workspaceLabels'
import type { useProjectStore } from '@/stores/ui/project'
import type { SessionGroup, UISession, useSessionStore } from '@/stores/ui/session'

export const CHAT_SECTION_GROUP_ID = '__chat__'
export const NO_PROJECT_GROUP_ID = '__no_project__'

export type SidebarWorkspaceGroup = SessionGroup & {
  environment?: EnvironmentSummary
}

interface UseSidebarWorkspaceGroupsOptions {
  sessionStore: ReturnType<typeof useSessionStore>
  projectStore: ReturnType<typeof useProjectStore>
  selectedAgentId: MaybeRefOrGetter<string | null>
  searchQuery: MaybeRefOrGetter<string>
  /** While true (e.g. during a group drag) the collapse-state sync watcher is paused. */
  suspendCollapseSync: MaybeRefOrGetter<boolean>
}

/**
 * Derives every sidebar grouping projection from the session and project stores: pinned
 * rows, the chat section, workspace groups (environment merge, ordering, duplicate-label
 * disambiguation) and the per-group collapse state.
 */
export function useSidebarWorkspaceGroups(options: UseSidebarWorkspaceGroupsOptions) {
  const { sessionStore, projectStore } = options

  const isPinnedSectionCollapsed = ref(false)
  const collapsedGroupIds = ref<Set<string>>(new Set())

  const normalizedSessionSearchQuery = computed(() =>
    toValue(options.searchQuery).trim().toLowerCase()
  )
  const matchesSessionSearch = (session: UISession) => {
    if (!normalizedSessionSearchQuery.value) {
      return true
    }

    return session.title.toLowerCase().includes(normalizedSessionSearchQuery.value)
  }

  const pinnedSessions = computed(() =>
    sessionStore.getPinnedSessions(toValue(options.selectedAgentId)).filter(matchesSessionSearch)
  )
  const baseFilteredGroups = computed(() =>
    sessionStore
      .getFilteredGroups(toValue(options.selectedAgentId))
      .map((group) => ({
        id: group.id,
        label: group.label,
        labelKey: group.labelKey,
        sessions: group.sessions.filter(matchesSessionSearch)
      }))
      .filter((group) => group.sessions.length > 0)
  )
  const defaultChatWorkspacePath = computed(() =>
    normalizeWorkspacePath(projectStore.defaultChatWorkspacePath)
  )
  const projectOrderIndex = computed(
    () =>
      new Map(
        projectStore.environments.map((environment, index) => [
          normalizeWorkspacePath(environment.path),
          index
        ])
      )
  )
  const activeProjectEnvironmentByPath = computed(
    () =>
      new Map(
        projectStore.environments.map((environment) => [
          normalizeWorkspacePath(environment.path),
          environment
        ])
      )
  )
  const historicalProjectEnvironmentByPath = computed(
    () =>
      new Map(
        [...projectStore.archivedEnvironments, ...projectStore.removedEnvironments].map(
          (environment) => [normalizeWorkspacePath(environment.path), environment]
        )
      )
  )
  const selectableProjectPathSet = computed(
    () => new Set(projectStore.projects.map((project) => normalizeWorkspacePath(project.path)))
  )
  const isChatSession = (session: UISession) => {
    const projectPath = normalizeWorkspacePath(session.projectDir)
    return (
      projectPath.length === 0 ||
      (defaultChatWorkspacePath.value.length > 0 && projectPath === defaultChatWorkspacePath.value)
    )
  }
  const isChatProjectGroup = (group: SessionGroup) =>
    group.id === NO_PROJECT_GROUP_ID ||
    (defaultChatWorkspacePath.value.length > 0 &&
      normalizeWorkspacePath(group.id) === defaultChatWorkspacePath.value)
  const isProjectDirectoryGroup = (group: SessionGroup) =>
    sessionStore.groupMode === 'project' &&
    group.id !== NO_PROJECT_GROUP_ID &&
    !group.labelKey &&
    !isChatProjectGroup(group)
  const getWorkspaceEnvironment = (group: SessionGroup) =>
    (group as SidebarWorkspaceGroup).environment
  const isActiveProjectDirectoryGroup = (group: SessionGroup) =>
    isProjectDirectoryGroup(group) && getWorkspaceEnvironment(group)?.status === 'active'
  const isWorkspaceUnavailable = (group: SessionGroup) =>
    isActiveProjectDirectoryGroup(group) && getWorkspaceEnvironment(group)?.exists === false
  const canStartConversationInProjectGroup = (group: SessionGroup) =>
    isActiveProjectDirectoryGroup(group) && !isWorkspaceUnavailable(group)
  const isTrueEmptyWorkspaceGroup = (group: SessionGroup) => {
    const environment = getWorkspaceEnvironment(group)
    return (
      canStartConversationInProjectGroup(group) &&
      environment?.sessionCount === 0 &&
      group.sessions.length === 0
    )
  }
  const compareProjectGroups = (left: SessionGroup, right: SessionGroup) => {
    const leftRank = isActiveProjectDirectoryGroup(left) ? 0 : 1
    const rightRank = isActiveProjectDirectoryGroup(right) ? 0 : 1

    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    const leftOrder =
      projectOrderIndex.value.get(normalizeWorkspacePath(left.id)) ?? Number.MAX_SAFE_INTEGER
    const rightOrder =
      projectOrderIndex.value.get(normalizeWorkspacePath(right.id)) ?? Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    return 0
  }
  const decorateWorkspaceGroup = (
    group: SessionGroup,
    environment: EnvironmentSummary | undefined
  ): SidebarWorkspaceGroup => ({
    ...group,
    ...(environment ? { environment } : {})
  })
  const sortProjectGroups = (groups: SidebarWorkspaceGroup[]) =>
    [...groups].sort(compareProjectGroups)
  const mergeProjectWorkspaceGroups = (sessionGroups: SessionGroup[]) => {
    const decoratedSessionGroups = sessionGroups.map((group) => {
      const pathIdentity = normalizeWorkspacePath(group.id)
      const environment =
        activeProjectEnvironmentByPath.value.get(pathIdentity) ??
        historicalProjectEnvironmentByPath.value.get(pathIdentity)
      return decorateWorkspaceGroup(group, environment)
    })

    if (!projectStore.snapshotReady || normalizedSessionSearchQuery.value.length > 0) {
      return sortProjectGroups(decoratedSessionGroups)
    }

    const sessionGroupByPath = new Map(
      decoratedSessionGroups.map((group) => [normalizeWorkspacePath(group.id), group])
    )
    const activeGroups = projectStore.environments
      .filter(
        (environment) =>
          normalizeWorkspacePath(environment.path) !== defaultChatWorkspacePath.value &&
          (!environment.isTemp ||
            selectableProjectPathSet.value.has(normalizeWorkspacePath(environment.path)) ||
            sessionGroupByPath.has(normalizeWorkspacePath(environment.path)))
      )
      .map((environment): SidebarWorkspaceGroup => {
        const pathIdentity = normalizeWorkspacePath(environment.path)
        const sessionGroup = sessionGroupByPath.get(pathIdentity)
        sessionGroupByPath.delete(pathIdentity)
        return {
          id: environment.path,
          label: sessionGroup?.label ?? environment.name,
          labelKey: sessionGroup?.labelKey,
          sessions: sessionGroup?.sessions ?? [],
          environment
        }
      })
    const historicalGroups = decoratedSessionGroups.filter((group) =>
      sessionGroupByPath.has(normalizeWorkspacePath(group.id))
    )

    return [...activeGroups, ...historicalGroups]
  }
  const orderedFilteredGroups = computed<SidebarWorkspaceGroup[]>(() => {
    const groups = baseFilteredGroups.value
    if (sessionStore.groupMode !== 'project') {
      return groups
    }

    const chatGroups = groups.filter(isChatProjectGroup)
    const workspaceSessionGroups = groups.filter(isProjectDirectoryGroup)
    return [...chatGroups, ...mergeProjectWorkspaceGroups(workspaceSessionGroups)]
  })
  const compareSidebarSessions = (left: UISession, right: UISession) => {
    const leftUpdatedAt = Number.isFinite(left.updatedAt) ? left.updatedAt : 0
    const rightUpdatedAt = Number.isFinite(right.updatedAt) ? right.updatedAt : 0
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt
    }

    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
  }
  const ensureSortedSessions = (
    sessions: UISession[],
    compare: (left: UISession, right: UISession) => number
  ) => {
    for (let index = 1; index < sessions.length; index += 1) {
      if (compare(sessions[index - 1], sessions[index]) > 0) {
        return [...sessions].sort(compare)
      }
    }

    return sessions
  }
  const sessionSections = computed(() => {
    if (sessionStore.groupMode === 'project') {
      const chatSessions = ensureSortedSessions(
        orderedFilteredGroups.value.filter(isChatProjectGroup).flatMap((group) => group.sessions),
        compareSidebarSessions
      )

      return {
        chatSessions,
        workspaceGroups: orderedFilteredGroups.value
          .filter(isProjectDirectoryGroup)
          .map((group) => {
            const sessions = ensureSortedSessions(group.sessions, compareSidebarSessions)
            return sessions === group.sessions ? group : { ...group, sessions }
          })
      }
    }

    const chatSessions: UISession[] = []
    const workspaceGroups: SessionGroup[] = []
    for (const group of orderedFilteredGroups.value) {
      const workspaceSessions: UISession[] = []
      for (const session of group.sessions) {
        if (isChatSession(session)) {
          chatSessions.push(session)
        } else {
          workspaceSessions.push(session)
        }
      }

      if (workspaceSessions.length > 0) {
        workspaceGroups.push({
          ...group,
          sessions: ensureSortedSessions(workspaceSessions, compareSidebarSessions)
        })
      }
    }

    return {
      chatSessions: ensureSortedSessions(chatSessions, compareSidebarSessions),
      workspaceGroups
    }
  })
  const chatSectionGroup = computed<SessionGroup | null>(() => {
    const sessions = sessionSections.value.chatSessions
    if (sessions.length === 0) {
      return null
    }

    return {
      id: CHAT_SECTION_GROUP_ID,
      label: 'chat.sidebar.chats',
      labelKey: 'chat.sidebar.chats',
      sessions
    }
  })
  const workspaceGroups = computed(() => {
    const groups = sessionSections.value.workspaceGroups
    // Duplicate basenames get the shortest parent suffix over the currently visible set, so
    // `.../team-a/app` and `.../archive/app` render as `app · team-a` and `app · archive`.
    const labelOverrides = disambiguateWorkspaceLabels(
      groups
        .filter((group) => isProjectDirectoryGroup(group))
        .map((group) => ({ id: normalizeWorkspacePath(group.id), label: group.label }))
    )
    if (labelOverrides.size === 0) {
      return groups
    }

    return groups.map((group) => {
      const label = labelOverrides.get(normalizeWorkspacePath(group.id))
      return label ? { ...group, label } : group
    })
  })
  const visibleGroups = computed(() => [
    ...(chatSectionGroup.value ? [chatSectionGroup.value] : []),
    ...workspaceGroups.value
  ])

  const getGroupIdentifier = (group: SessionGroup) => normalizeWorkspacePath(group.id)
  const getWorkspacePath = (group: SessionGroup) => getWorkspaceEnvironment(group)?.path ?? group.id

  const getGroupIcon = (group: SessionGroup) =>
    isTrueEmptyWorkspaceGroup(group)
      ? 'lucide:folder'
      : isGroupCollapsed(group)
        ? 'lucide:folder-closed'
        : 'lucide:folder-open'

  const isGroupCollapsed = (group: SessionGroup) =>
    collapsedGroupIds.value.has(getGroupIdentifier(group))
  const getWorkspaceGroupAriaExpanded = (group: SessionGroup) =>
    isTrueEmptyWorkspaceGroup(group) ? undefined : !isGroupCollapsed(group)

  const canAutoFillSessionList = computed(
    () =>
      normalizedSessionSearchQuery.value.length === 0 &&
      !isPinnedSectionCollapsed.value &&
      !visibleGroups.value.some(isGroupCollapsed)
  )

  const visibleSessionFingerprint = computed(() =>
    [
      isPinnedSectionCollapsed.value ? 'pinned:collapsed' : 'pinned:expanded',
      ...pinnedSessions.value.map((session) => `pinned:${session.id}`),
      ...visibleGroups.value.flatMap((group) => [
        `group:${getGroupIdentifier(group)}:${isGroupCollapsed(group) ? 'collapsed' : 'expanded'}`,
        ...(!isGroupCollapsed(group) ? group.sessions.map((session) => session.id) : [])
      ])
    ].join('|')
  )

  const togglePinnedSection = () => {
    isPinnedSectionCollapsed.value = !isPinnedSectionCollapsed.value
  }

  const toggleGroup = (group: SessionGroup) => {
    const groupId = getGroupIdentifier(group)
    const nextCollapsedGroupIds = new Set(collapsedGroupIds.value)

    if (nextCollapsedGroupIds.has(groupId)) {
      nextCollapsedGroupIds.delete(groupId)
    } else {
      nextCollapsedGroupIds.add(groupId)
    }

    collapsedGroupIds.value = nextCollapsedGroupIds
  }

  watch(
    [pinnedSessions, () => sessionStore.activeSessionId],
    ([sessions, activeSessionId]) => {
      if (sessions.length === 0) {
        isPinnedSectionCollapsed.value = false
        return
      }

      if (activeSessionId && sessions.some((session) => session.id === activeSessionId)) {
        isPinnedSectionCollapsed.value = false
      }
    },
    { immediate: true }
  )

  watch(
    [visibleGroups, () => sessionStore.activeSessionId],
    ([groups, activeSessionId]) => {
      if (toValue(options.suspendCollapseSync)) {
        return
      }

      const validGroupIds = new Set(
        groups.filter((group) => !isTrueEmptyWorkspaceGroup(group)).map(getGroupIdentifier)
      )
      const nextCollapsedGroupIds = new Set(
        [...collapsedGroupIds.value].filter((groupId) => validGroupIds.has(groupId))
      )

      if (activeSessionId) {
        const activeGroup = groups.find((group) =>
          group.sessions.some((session) => session.id === activeSessionId)
        )

        if (activeGroup) {
          nextCollapsedGroupIds.delete(getGroupIdentifier(activeGroup))
        }
      }

      const stateChanged =
        nextCollapsedGroupIds.size !== collapsedGroupIds.value.size ||
        [...nextCollapsedGroupIds].some((groupId) => !collapsedGroupIds.value.has(groupId))

      if (stateChanged) {
        collapsedGroupIds.value = nextCollapsedGroupIds
      }
    },
    { immediate: true }
  )

  return {
    normalizedSessionSearchQuery,
    matchesSessionSearch,
    pinnedSessions,
    defaultChatWorkspacePath,
    chatSectionGroup,
    workspaceGroups: workspaceGroups as ComputedRef<SidebarWorkspaceGroup[]>,
    visibleGroups,
    isPinnedSectionCollapsed,
    isChatProjectGroup,
    isProjectDirectoryGroup,
    isActiveProjectDirectoryGroup,
    isWorkspaceUnavailable,
    canStartConversationInProjectGroup,
    isTrueEmptyWorkspaceGroup,
    getWorkspaceEnvironment,
    getGroupIdentifier,
    getWorkspacePath,
    getGroupIcon,
    isGroupCollapsed,
    getWorkspaceGroupAriaExpanded,
    canAutoFillSessionList,
    visibleSessionFingerprint,
    togglePinnedSection,
    toggleGroup
  }
}
