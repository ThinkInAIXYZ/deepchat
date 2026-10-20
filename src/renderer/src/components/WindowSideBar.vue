<template>
  <TooltipProvider :delay-duration="200">
    <nav
      :aria-label="t('chat.sidebar.allAgents')"
      data-testid="window-sidebar"
      class="window-sidebar-shell flex flex-col h-full shrink-0 overflow-hidden window-drag-region transition-[width] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
      :class="collapsed ? 'w-12' : 'w-[264px]'"
    >
      <div class="window-no-drag-region shrink-0 px-2 pb-2 pt-3">
        <div class="flex items-start gap-1" :class="collapsed ? 'flex-col' : ''">
          <DcButton
            data-testid="window-sidebar-toggle"
            variant="ghost"
            size="icon"
            :icon="collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'"
            :aria-expanded="!collapsed"
            aria-controls="sidebar-sessions"
            :tooltip="
              collapsed ? t('chat.sidebar.expandSidebar') : t('chat.sidebar.collapseSidebar')
            "
            :tooltip-delay-duration="200"
            tooltip-side="right"
            class="shrink-0 text-muted-foreground"
            @click="sidebarStore.toggleSidebar()"
          />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <DcButton
                data-testid="sidebar-agent-selector"
                :data-selected-agent-id="sidebarSelectedAgentId ?? '__all__'"
                variant="ghost"
                :size="collapsed ? 'icon' : 'default'"
                :label="selectedAgentName"
                :tooltip="collapsed ? selectedAgentName : undefined"
                :tooltip-delay-duration="200"
                tooltip-side="right"
                class="min-w-0 flex-1 justify-start gap-2 px-2"
              >
                <AgentAvatar
                  v-if="sidebarSelectedAgent"
                  :agent="sidebarSelectedAgent"
                  class-name="size-4 shrink-0"
                />
                <Icon v-else icon="lucide:layers" class="size-4 shrink-0 text-muted-foreground" />
                <span
                  v-if="!collapsed"
                  class="min-w-0 flex-1 truncate text-left text-sm font-medium"
                >
                  {{ selectedAgentName }}
                </span>
                <Icon
                  v-if="!collapsed"
                  icon="lucide:chevron-down"
                  class="size-3 text-muted-foreground"
                />
              </DcButton>
            </DropdownMenuTrigger>
            <!-- Keep collision handling from flipping into the native title bar. -->
            <DropdownMenuContent
              data-testid="sidebar-agent-menu"
              side="bottom"
              :side-flip="false"
              align="start"
              :collision-padding="8"
              class="w-60"
            >
              <DropdownMenuItem
                data-testid="sidebar-agent-all-button"
                role="menuitemradio"
                :aria-checked="sidebarSelectedAgentId === null"
                data-agent-id="__all__"
                :data-selected="String(sidebarSelectedAgentId === null)"
                class="gap-2"
                @select="handleAgentSelect(null)"
              >
                <Icon icon="lucide:layers" class="size-4" />
                <span class="flex-1">{{ t('chat.sidebar.allAgents') }}</span>
                <Icon v-if="sidebarSelectedAgentId === null" icon="lucide:check" class="size-4" />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                v-for="agent in agentStore.enabledAgents"
                :key="agent.id"
                data-testid="sidebar-agent-button"
                role="menuitemradio"
                :aria-checked="sidebarSelectedAgentId === agent.id"
                :data-agent-id="agent.id"
                :data-agent-type="agent.agentType ?? agent.type"
                :data-selected="String(sidebarSelectedAgentId === agent.id)"
                class="gap-2"
                @select="handleAgentSelect(agent.id)"
              >
                <AgentAvatar :agent="agent" class-name="size-4" />
                <span class="min-w-0 flex-1 truncate">{{ agent.name }}</span>
                <Icon
                  v-if="sidebarSelectedAgentId === agent.id"
                  icon="lucide:check"
                  class="size-4"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div class="mt-2 flex flex-col gap-1">
          <DcButton
            data-testid="app-new-chat-button"
            variant="ghost"
            :size="collapsed ? 'icon' : 'default'"
            icon="lucide:square-pen"
            :label="t('common.newChat')"
            :tooltip="collapsed ? t('common.newChat') : undefined"
            :tooltip-delay-duration="200"
            tooltip-side="right"
            class="justify-start px-2 text-sm font-normal"
            @click="handleNewChat"
          >
            <span v-if="!collapsed">{{ t('common.newChat') }}</span>
          </DcButton>
          <DcButton
            data-testid="app-search-command-button"
            variant="ghost"
            :size="collapsed ? 'icon' : 'default'"
            icon="lucide:search"
            :label="t('chat.sidebar.searchCommand')"
            :tooltip="collapsed ? t('chat.sidebar.searchCommand') : undefined"
            :tooltip-delay-duration="200"
            :title="t('chat.spotlight.placeholder')"
            tooltip-side="right"
            class="justify-start px-2 text-sm font-normal"
            :active="spotlightStore.open"
            @click="spotlightStore.toggleSpotlight()"
          >
            <span v-if="!collapsed">{{ t('chat.sidebar.searchCommand') }}</span>
          </DcButton>
        </div>
      </div>

      <div
        id="sidebar-sessions"
        data-testid="window-sidebar-session-column"
        class="window-sidebar-session-column window-no-drag-region min-h-0 flex-1 flex-col"
        :class="collapsed ? 'hidden' : 'flex'"
        :aria-hidden="collapsed ? 'true' : undefined"
        :inert="collapsed ? true : undefined"
      >
        <div class="relative mx-3 mb-2">
          <Icon
            icon="lucide:list-filter"
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            v-model="sessionSearchQuery"
            data-testid="sidebar-session-search-input"
            type="search"
            :placeholder="t('chat.sidebar.searchPlaceholder')"
            :aria-label="t('chat.sidebar.searchAriaLabel')"
            class="h-8 border-transparent bg-transparent pl-8 text-xs shadow-none hover:border-border focus-visible:border-input"
            @keydown.esc.prevent="sessionSearchQuery = ''"
          />
        </div>

        <div
          v-if="!sessionStore.hasLoadedInitialPage && sessionStore.loading"
          class="flex flex-col gap-2 px-3 pb-3"
          data-testid="window-sidebar-loading-first-page"
        >
          <Skeleton
            v-for="row in 6"
            :key="`session-skeleton-${row}`"
            class="h-10 rounded-lg bg-muted/50"
          />
        </div>

        <!-- Empty state -->
        <DcEmpty
          v-if="
            sessionStore.hasLoadedInitialPage &&
            pinnedSessions.length === 0 &&
            !chatSectionGroup &&
            workspaceGroups.length === 0
          "
          icon="lucide:message-square-plus"
          class="flex-none border-0 bg-transparent px-4 py-6"
          :title="
            normalizedSessionSearchQuery
              ? t('chat.sidebar.searchEmptyTitle')
              : t('chat.sidebar.emptyTitle')
          "
          :description="
            normalizedSessionSearchQuery
              ? sessionStore.hasMore
                ? t('chat.sidebar.searchLoadedRangeDescription')
                : t('chat.sidebar.searchEmptyDescription')
              : t('chat.sidebar.emptyDescription')
          "
        />

        <!-- Session list -->
        <div
          ref="sessionListRef"
          class="session-list min-h-0 flex-1 overflow-y-auto px-2"
          @scroll.passive="handleSessionListScroll"
        >
          <div v-if="pinnedSessions.length > 0" class="pt-2">
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground"
              data-group-id="__pinned__"
              :aria-expanded="!isPinnedSectionCollapsed"
              @click="togglePinnedSection"
            >
              <span class="shrink-0 size-6 flex items-center justify-center">
                <Icon
                  :icon="isPinnedSectionCollapsed ? 'lucide:folder-closed' : 'lucide:folder-open'"
                  class="size-4"
                />
              </span>
              <span class="truncate">
                {{ t('chat.sidebar.pinned') }}
              </span>
            </button>

            <div v-show="!isPinnedSectionCollapsed" class="space-y-0.5">
              <WindowSideBarSessionItem
                v-for="session in pinnedSessions"
                :key="`pinned-${session.id}`"
                :session="session"
                :active="sessionStore.activeSessionId === session.id"
                region="pinned"
                :hero-hidden="pinFlightSessionId === session.id"
                :hero-placeholder="pinFlightSessionId === session.id"
                :force-pin-docked="pinDockedSessionId === session.id"
                :pin-feedback-mode="pinFeedbackSessionId === session.id ? pinFeedbackMode : null"
                :search-query="sessionSearchQuery"
                :shortcut-badge-label="getShortcutBadgeLabelForSession(session.id)"
                :shortcut-badge-visible="hasShortcutBadgeForSession(session.id)"
                @select="handleSessionClick"
                @toggle-pin="handleTogglePin"
                @delete="openDeleteDialog"
              />
            </div>
          </div>

          <div v-if="chatSectionGroup" class="mt-3">
            <div
              class="group flex w-full items-center gap-1 rounded-md pr-1 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-within:bg-accent/40 focus-within:text-foreground"
              :class="
                revealedWorkspaceGroupId === CHAT_SECTION_GROUP_ID
                  ? 'bg-accent/70 ring-1 ring-primary/20'
                  : ''
              "
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center px-2 py-1.5 text-left"
                :data-group-id="getGroupIdentifier(chatSectionGroup)"
                :aria-expanded="!isGroupCollapsed(chatSectionGroup)"
                @click="toggleGroup(chatSectionGroup)"
              >
                <span class="truncate">
                  {{ t('chat.sidebar.chatSection') }}
                </span>
              </button>
              <DcButton
                type="button"
                data-testid="window-sidebar-chat-new-button"
                size="icon-sm"
                icon="lucide:plus"
                icon-size="4"
                variant="ghost"
                :tooltip="t('common.newChat')"
                :tooltip-delay-duration="200"
                @click.stop="handleNewChatForProject(defaultChatWorkspacePath || null)"
              />
            </div>

            <TransitionGroup
              v-show="!isGroupCollapsed(chatSectionGroup)"
              name="chat-session-row"
              tag="div"
              class="space-y-0.5"
              :class="{ 'chat-session-rows-static': chatSessionRowsStatic }"
            >
              <WindowSideBarSessionItem
                v-for="session in getVisibleGroupSessions(chatSectionGroup)"
                :key="session.id"
                :session="session"
                :active="sessionStore.activeSessionId === session.id"
                region="grouped"
                :hero-hidden="pinFlightSessionId === session.id"
                :hero-placeholder="pinFlightSessionId === session.id"
                :force-pin-docked="pinDockedSessionId === session.id"
                :pin-feedback-mode="pinFeedbackSessionId === session.id ? pinFeedbackMode : null"
                :search-query="sessionSearchQuery"
                :shortcut-badge-label="getShortcutBadgeLabelForSession(session.id)"
                :shortcut-badge-visible="hasShortcutBadgeForSession(session.id)"
                @select="handleSessionClick"
                @toggle-pin="handleTogglePin"
                @delete="openDeleteDialog"
              />
            </TransitionGroup>
            <button
              v-if="!isGroupCollapsed(chatSectionGroup) && hasMoreGroupSessions(chatSectionGroup)"
              type="button"
              data-testid="sidebar-group-show-more"
              :data-group-id="`${getGroupIdentifier(chatSectionGroup)}:more`"
              :disabled="isGroupLoading(chatSectionGroup)"
              :aria-busy="isGroupLoading(chatSectionGroup)"
              :aria-label="`${getGroupLabel(chatSectionGroup)}: ${getShowMoreLabel(chatSectionGroup)}`"
              class="w-full rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait"
              @click="handleShowMoreGroup(chatSectionGroup, $event)"
            >
              {{ getShowMoreLabel(chatSectionGroup) }}
            </button>
          </div>

          <div
            class="flex items-center justify-between gap-2 px-2 pb-1"
            :class="
              pinnedSessions.length > 0 || chatSectionGroup
                ? 'mt-3 border-t border-border/60 pt-3'
                : 'pt-4'
            "
          >
            <div class="min-w-0 truncate text-xs font-semibold text-muted-foreground">
              {{ t('chat.sidebar.workspace') }}
            </div>
            <div class="flex items-center gap-0.5">
              <DcButton
                size="icon-sm"
                icon="lucide:folder-plus"
                icon-size="4"
                data-testid="window-sidebar-add-workspace-button"
                :tooltip="t('chat.sidebar.addWorkspace')"
                :tooltip-delay-duration="200"
                :aria-label="t('chat.sidebar.addWorkspace')"
                :disabled="isAddingWorkspace"
                variant="ghost"
                class="flex items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-accent/50 hover:text-foreground"
                @click="handleAddWorkspace"
              />
              <DcButton
                size="icon-sm"
                icon="lucide:folder-kanban"
                icon-size="4"
                :tooltip-delay-duration="200"
                :tooltip="
                  sessionStore.groupMode === 'project'
                    ? t('chat.sidebar.groupByDate')
                    : t('chat.sidebar.groupByProject')
                "
                variant="ghost"
                class="flex items-center justify-center rounded-md transition-all duration-150"
                :class="
                  sessionStore.groupMode === 'project'
                    ? 'bg-accent/80 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                "
                @click="sessionStore.toggleGroupMode()"
              />
            </div>
          </div>

          <draggable
            :model-value="workspaceGroups"
            item-key="id"
            tag="div"
            handle=".sidebar-project-folder-target"
            :animation="150"
            ghost-class="sidebar-project-group-ghost"
            chosen-class="sidebar-project-group-chosen"
            :disabled="!canReorderProjectGroups"
            @start="handleProjectGroupDragStart"
            @end="handleProjectGroupDragEnd"
            @update:model-value="handleProjectGroupModelUpdate"
          >
            <template #item="{ element: group }">
              <div>
                <div
                  class="group mt-2 flex w-full select-none items-center gap-1 rounded-md pr-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-within:bg-accent/40 focus-within:text-foreground"
                  :class="[
                    isProjectGroupDragging ? 'pointer-events-none' : '',
                    revealedWorkspaceGroupId === getGroupIdentifier(group)
                      ? 'bg-accent/70 ring-1 ring-primary/20'
                      : ''
                  ]"
                >
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left"
                        :class="
                          isProjectGroupReorderTarget(group) && canReorderProjectGroups
                            ? 'sidebar-project-folder-target cursor-grab active:cursor-grabbing'
                            : ''
                        "
                        :data-group-id="getGroupIdentifier(group)"
                        :aria-expanded="getWorkspaceGroupAriaExpanded(group)"
                        @click="handleWorkspaceGroupClick(group)"
                      >
                        <span class="shrink-0 size-6 flex items-center justify-center">
                          <Icon
                            :icon="getGroupIcon(group)"
                            :data-icon="getGroupIcon(group)"
                            data-testid="window-sidebar-group-icon"
                            class="size-4"
                          />
                        </span>
                        <span class="truncate">
                          {{ getGroupLabel(group) }}
                        </span>
                        <DcBadge
                          v-if="isDefaultWorkspaceGroup(group)"
                          variant="active"
                          data-testid="window-sidebar-default-workspace-badge"
                          class="ms-auto px-1 py-0 text-[10px]"
                        >
                          {{ t('settings.environments.badges.default') }}
                        </DcBadge>
                        <span
                          v-if="isTrueEmptyWorkspaceGroup(group)"
                          data-testid="window-sidebar-empty-workspace-label"
                          class="ms-auto shrink-0 text-[10px] font-normal text-muted-foreground/70"
                        >
                          {{ t('chat.sidebar.emptyWorkspace') }}
                        </span>
                        <span
                          v-if="isWorkspaceUnavailable(group)"
                          class="ms-auto flex shrink-0 items-center"
                          :title="
                            t('chat.input.workspaceUnavailableTooltip', {
                              path: getWorkspacePath(group)
                            })
                          "
                        >
                          <Icon
                            icon="lucide:circle-alert"
                            data-testid="window-sidebar-workspace-unavailable"
                            aria-hidden="true"
                            class="size-3.5 text-amber-500"
                          />
                        </span>
                        <span v-if="isWorkspaceUnavailable(group)" class="sr-only">
                          {{
                            t('chat.input.workspaceUnavailableTooltip', {
                              path: getWorkspacePath(group)
                            })
                          }}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      v-if="isProjectDirectoryGroup(group)"
                      side="right"
                      data-testid="workspace-path-tooltip"
                      class="max-w-72 text-wrap break-words"
                    >
                      {{ getGroupIdentifier(group) }}
                    </TooltipContent>
                  </Tooltip>

                  <DcButton
                    v-if="canStartConversationInProjectGroup(group)"
                    type="button"
                    data-testid="window-sidebar-project-new-button"
                    size="icon-sm"
                    icon="lucide:plus"
                    icon-size="3.5"
                    variant="ghost"
                    :tooltip="t('common.newChat')"
                    :tooltip-delay-duration="200"
                    class="flex items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100"
                    :class="
                      isTrueEmptyWorkspaceGroup(group)
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                    "
                    @click.stop="handleNewChatForWorkspaceGroup(group)"
                  />

                  <DropdownMenu v-if="isActiveProjectDirectoryGroup(group)">
                    <DropdownMenuTrigger as-child>
                      <DcButton
                        type="button"
                        size="icon-sm"
                        icon="lucide:ellipsis"
                        icon-size="3.5"
                        :tooltip="t('common.more')"
                        :tooltip-delay-duration="200"
                        variant="ghost"
                        :aria-label="t('chat.sidebar.projectGroupActions')"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-48">
                      <DcDropdownActionItem
                        icon="lucide:message-square-plus"
                        :label="t('common.newChat')"
                        :disabled="!canStartConversationInProjectGroup(group)"
                        data-testid="window-sidebar-new-chat-workspace-menu-item"
                        @select="handleNewChatForWorkspaceGroup(group)"
                      />
                      <DcDropdownActionItem
                        icon="lucide:folder-open"
                        :label="t('chat.sidebar.openWorkspaceFolder')"
                        :disabled="!canOpenWorkspace(group) || workspaceOperationPending"
                        data-testid="window-sidebar-open-workspace-menu-item"
                        @select="handleOpenWorkspace(group)"
                      />
                      <DcDropdownActionItem
                        icon="lucide:star"
                        :label="t('settings.environments.actions.setDefault')"
                        :disabled="!canSetDefaultWorkspace(group) || workspaceOperationPending"
                        data-testid="window-sidebar-set-default-workspace-menu-item"
                        @select="handleSetDefaultWorkspace(group)"
                      />
                      <DropdownMenuSeparator />
                      <DcDropdownActionItem
                        icon="lucide:chevrons-up"
                        :label="t('chat.sidebar.moveProjectGroupTop')"
                        :disabled="!canMoveProjectGroup(group, -1)"
                        @select="handleMoveProjectGroup(group, 'top')"
                      />
                      <DcDropdownActionItem
                        icon="lucide:chevron-up"
                        :label="t('chat.sidebar.moveProjectGroupUp')"
                        :disabled="!canMoveProjectGroup(group, -1)"
                        @select="handleMoveProjectGroup(group, 'up')"
                      />
                      <DcDropdownActionItem
                        icon="lucide:chevron-down"
                        :label="t('chat.sidebar.moveProjectGroupDown')"
                        :disabled="!canMoveProjectGroup(group, 1)"
                        @select="handleMoveProjectGroup(group, 'down')"
                      />
                      <DcDropdownActionItem
                        icon="lucide:chevrons-down"
                        :label="t('chat.sidebar.moveProjectGroupBottom')"
                        :disabled="!canMoveProjectGroup(group, 1)"
                        @select="handleMoveProjectGroup(group, 'bottom')"
                      />
                      <DropdownMenuSeparator />
                      <DcDropdownActionItem
                        icon="lucide:archive"
                        :label="t('settings.environments.actions.archive')"
                        data-testid="window-sidebar-archive-workspace-menu-item"
                        :disabled="isArchivingWorkspace || workspaceOperationPending"
                        @select="requestWorkspaceArchive(group)"
                      />
                      <DropdownMenuSeparator />
                      <DcDropdownActionItem
                        icon="lucide:folders"
                        :label="t('chat.sidebar.manageWorkspaces')"
                        data-testid="window-sidebar-manage-workspaces-menu-item"
                        @select="openWorkspaceSettings"
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div v-show="!isGroupCollapsed(group)" class="space-y-0.5">
                  <WindowSideBarSessionItem
                    v-for="session in getVisibleGroupSessions(group)"
                    :key="session.id"
                    :session="session"
                    :active="sessionStore.activeSessionId === session.id"
                    region="grouped"
                    :hero-hidden="pinFlightSessionId === session.id"
                    :hero-placeholder="pinFlightSessionId === session.id"
                    :force-pin-docked="pinDockedSessionId === session.id"
                    :pin-feedback-mode="
                      pinFeedbackSessionId === session.id ? pinFeedbackMode : null
                    "
                    :search-query="sessionSearchQuery"
                    :shortcut-badge-label="getShortcutBadgeLabelForSession(session.id)"
                    :shortcut-badge-visible="hasShortcutBadgeForSession(session.id)"
                    @select="handleSessionClick"
                    @toggle-pin="handleTogglePin"
                    @delete="openDeleteDialog"
                  />
                  <button
                    v-if="hasMoreGroupSessions(group)"
                    type="button"
                    data-testid="sidebar-group-show-more"
                    :data-group-id="`${getGroupIdentifier(group)}:more`"
                    :disabled="isGroupLoading(group)"
                    :aria-busy="isGroupLoading(group)"
                    :aria-label="`${getGroupLabel(group)}: ${getShowMoreLabel(group)}`"
                    class="w-full rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait"
                    @click="handleShowMoreGroup(group, $event)"
                  >
                    {{ getShowMoreLabel(group) }}
                  </button>
                </div>
              </div>
            </template>
          </draggable>

          <p
            v-if="normalizedSessionSearchQuery && sessionStore.hasMore && !sessionStore.loadingMore"
            data-testid="sidebar-session-search-loaded-range"
            class="px-2 py-3 text-center text-xs text-muted-foreground/70"
          >
            {{ t('chat.sidebar.searchLoadedRangeDescription') }}
          </p>

          <div
            v-if="sessionStore.loadingMore"
            class="px-2 py-3 text-center text-xs text-muted-foreground/70"
          >
            {{ t('common.loading') }}
          </div>

          <div
            v-if="sessionStore.error && sessionStore.hasLoadedInitialPage"
            data-testid="sidebar-session-pagination-error"
            class="flex items-center justify-between gap-2 px-2 py-3 text-xs text-destructive"
            role="status"
          >
            <span class="min-w-0 flex-1 truncate">{{ sessionStore.error }}</span>
            <DcButton
              data-testid="sidebar-session-pagination-retry"
              type="button"
              variant="outline"
              size="sm"
              class="h-7 shrink-0 px-2 text-xs"
              :disabled="sessionStore.loadingMore || !sessionStore.hasMore"
              @click="sessionStore.loadNextPage()"
            >
              {{ t('common.browser.reload') }}
            </DcButton>
          </div>
        </div>
      </div>
      <div class="window-no-drag-region mt-auto shrink-0 border-t border-border/60 px-2 py-2">
        <DcButton
          data-testid="app-plugins-button"
          variant="ghost"
          :size="collapsed ? 'icon' : 'default'"
          icon="lucide:blocks"
          :label="t('routes.plugins')"
          :tooltip="collapsed ? t('routes.plugins') : undefined"
          :tooltip-delay-duration="200"
          tooltip-side="right"
          :active="pluginsRouteActive"
          class="w-full justify-start px-2 text-sm font-normal"
          @click="openPlugins"
        >
          <span v-if="!collapsed">{{ t('routes.plugins') }}</span>
        </DcButton>
        <DcButton
          data-testid="app-scheduled-tasks-button"
          variant="ghost"
          :size="collapsed ? 'icon' : 'default'"
          icon="lucide:calendar-clock"
          :label="t('routes.settings-scheduled-tasks')"
          :tooltip="collapsed ? t('routes.settings-scheduled-tasks') : undefined"
          :tooltip-delay-duration="200"
          tooltip-side="right"
          class="w-full justify-start px-2 text-sm font-normal"
          @click="settingsClient.openSettings({ routeName: 'settings-scheduled-tasks' })"
        >
          <span v-if="!collapsed">{{ t('routes.settings-scheduled-tasks') }}</span>
        </DcButton>
        <div class="flex flex-wrap items-center gap-1">
          <DcButton
            data-testid="app-settings-button"
            variant="ghost"
            :size="collapsed ? 'icon' : 'default'"
            icon="lucide:settings-2"
            :label="t('routes.settings')"
            :tooltip="collapsed ? t('routes.settings') : undefined"
            :tooltip-delay-duration="200"
            tooltip-side="right"
            class="min-w-0 flex-1 justify-start px-2 text-sm font-normal"
            @click="openSettings"
          >
            <span v-if="!collapsed">{{ t('routes.settings') }}</span>
          </DcButton>
          <DcButton
            v-if="showRemoteControlButton"
            data-testid="remote-control-button"
            variant="ghost"
            size="icon-sm"
            icon="lucide:monitor-cloud"
            :tooltip="remoteControlTooltip"
            :tooltip-delay-duration="200"
            :title="remoteControlTooltip"
            tooltip-side="right"
            tooltip-content-class="whitespace-pre-line"
            :class="remoteControlButtonClass"
            :icon-class="remoteControlIconClass"
            @click="openRemoteSettings"
          />
          <DcButton
            data-testid="window-sidebar-theme-toggle"
            variant="ghost"
            size="icon-sm"
            :icon="themeIcon"
            :tooltip="`${t('chat.sidebar.themeToggle')} · ${themeModeLabel}`"
            :tooltip-delay-duration="200"
            tooltip-side="right"
            class="text-muted-foreground"
            @click="themeStore.cycleTheme()"
          />
        </div>
      </div>
    </nav>
  </TooltipProvider>

  <Dialog v-model:open="deleteDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.delete.title') }}</DialogTitle>
        <DialogDescription>{{ t('dialog.delete.description') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DcButton variant="outline" @click="deleteDialogOpen = false">{{
          t('dialog.cancel')
        }}</DcButton>
        <DcButton variant="destructive" @click="handleDeleteConfirm">{{
          t('dialog.delete.confirm')
        }}</DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="archiveWorkspaceDialogOpen">
    <DialogContent data-testid="window-sidebar-archive-workspace-dialog">
      <DialogHeader>
        <DialogTitle>
          {{
            t('settings.environments.confirm.archiveTitle', {
              name: archiveTargetWorkspace?.name ?? ''
            })
          }}
        </DialogTitle>
        <DialogDescription>
          {{ t('settings.environments.confirm.archiveDescription') }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DcButton
          data-testid="window-sidebar-archive-workspace-cancel"
          variant="outline"
          :disabled="isArchivingWorkspace"
          @click="archiveWorkspaceDialogOpen = false"
        >
          {{ t('common.cancel') }}
        </DcButton>
        <DcButton
          data-testid="window-sidebar-archive-workspace-confirm"
          :disabled="isArchivingWorkspace"
          @click="handleArchiveWorkspaceConfirm"
        >
          <Icon
            v-if="isArchivingWorkspace"
            icon="lucide:loader-circle"
            class="mr-2 size-4 animate-spin"
          />
          {{ t('settings.environments.actions.archive') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcBadge } from '@dc-ui/components/badge'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import { DcEmpty } from '@dc-ui/components/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Input } from '@shadcn/components/ui/input'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { createSettingsClient } from '@api/SettingsClient'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import {
  useSessionStore,
  type SessionGroup,
  type StartNewConversationOptions,
  type UISession
} from '@/stores/ui/session'
import { useSpotlightStore } from '@/stores/ui/spotlight'
import { usePluginCatalogStore } from '@/stores/pluginCatalog'
import {
  CHAT_SECTION_GROUP_ID,
  useSidebarWorkspaceGroups
} from '@/composables/sidebar/useSidebarWorkspaceGroups'
import {
  restoreSessionListScrollTop,
  useSessionListAutoFill
} from '@/composables/sidebar/useSessionListAutoFill'
import { useSessionPinFlight } from '@/composables/sidebar/useSessionPinFlight'
import { useSidebarSessionShortcuts } from '@/composables/sidebar/useSidebarSessionShortcuts'
import { useProjectGroupReorder } from '@/composables/sidebar/useProjectGroupReorder'
import { useSidebarWorkspaceActions } from '@/composables/sidebar/useSidebarWorkspaceActions'
import { useSidebarRemoteControl } from '@/composables/sidebar/useSidebarRemoteControl'
import AgentAvatar from './icons/AgentAvatar.vue'
import WindowSideBarSessionItem from './WindowSideBarSessionItem.vue'
import { useI18n } from 'vue-i18n'
import { useSidebarStore } from '@/stores/ui/sidebar'
import { useThemeStore } from '@/stores/theme'

const settingsClient = createSettingsClient()
const { t } = useI18n()
const router = useRouter()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const sidebarStore = useSidebarStore()
const spotlightStore = useSpotlightStore()
const themeStore = useThemeStore()
const pluginCatalogStore = usePluginCatalogStore()

// line-md 过渡图标自带线条流动动画：切到该模式时，线条会绘制/morph 成对应形状
const themeIcon = computed(() => {
  switch (themeStore.themeMode) {
    case 'light':
      // 线条流动收拢成太阳（光线逐根画出）
      return 'line-md:moon-to-sunny-outline-transition'
    case 'dark':
      // 太阳线条流动 morph 成月亮
      return 'line-md:sunny-outline-to-moon-transition'
    default:
      // 显示器轮廓线条逐段绘制
      return 'line-md:monitor'
  }
})

const themeModeLabel = computed(() => {
  switch (themeStore.themeMode) {
    case 'light':
      return t('chat.sidebar.themeLight')
    case 'dark':
      return t('chat.sidebar.themeDark')
    default:
      return t('chat.sidebar.themeSystem')
  }
})

const collapsed = computed(() => sidebarStore.collapsed)
const sessionSearchQuery = ref('')
const pluginsRouteActive = computed(() =>
  String(router?.currentRoute?.value?.name ?? '').startsWith('plugins')
)
let agentSwitchSeq = 0
let agentSwitchQueue: Promise<void> = Promise.resolve()

const sidebarSelectedAgentId = computed(() => agentStore.filterAgentId)

const sidebarSelectedAgent = computed(() => {
  if (sidebarSelectedAgentId.value === null) {
    return undefined
  }

  if (agentStore.selectedAgent?.id === sidebarSelectedAgentId.value) {
    return agentStore.selectedAgent
  }

  return agentStore.enabledAgents.find((agent) => agent.id === sidebarSelectedAgentId.value)
})

const selectedAgentName = computed(
  () => sidebarSelectedAgent.value?.name ?? t('chat.sidebar.allAgents')
)

const sessionListRef = ref<HTMLElement | null>(null)
// Shared with the reorder/auto-fill/group composables: a group drag pauses collapse
// sync, scroll pagination and viewport auto-fill until the drop settles.
const isProjectGroupDragging = ref(false)
const deleteTargetSession = ref<UISession | null>(null)

const deleteDialogOpen = computed({
  get: () => deleteTargetSession.value !== null,
  set: (open: boolean) => {
    if (!open) {
      deleteTargetSession.value = null
    }
  }
})

const {
  showRemoteControlButton,
  remoteControlTooltip,
  remoteControlButtonClass,
  remoteControlIconClass,
  openRemoteSettings
} = useSidebarRemoteControl({ pluginCatalogStore, settingsClient, router, t })

const {
  pinFlightSessionId,
  pinDockedSessionId,
  pinFeedbackSessionId,
  pinFeedbackMode,
  handleTogglePin
} = useSessionPinFlight({ sessionStore, sessionListRef })

const {
  normalizedSessionSearchQuery,
  pinnedSessions,
  defaultChatWorkspacePath,
  chatSectionGroup,
  workspaceGroups,
  visibleGroups,
  renderedGroups,
  getVisibleGroupSessions,
  hasMoreGroupSessions,
  isGroupLoading,
  hasGroupLoadError,
  showMoreGroupSessions,
  isPinnedSectionCollapsed,
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
} = useSidebarWorkspaceGroups({
  sessionStore,
  projectStore,
  selectedAgentId: sidebarSelectedAgentId,
  sidebarCollapsed: collapsed,
  searchQuery: sessionSearchQuery,
  suspendCollapseSync: isProjectGroupDragging
})

const { handleSessionListScroll, ensureSessionListFilled } = useSessionListAutoFill({
  sessionStore,
  sessionListRef,
  collapsed,
  canAutoFill: canAutoFillSessionList,
  suspended: isProjectGroupDragging,
  fillCheckSources: [
    sidebarSelectedAgentId,
    normalizedSessionSearchQuery,
    visibleSessionFingerprint
  ]
})

const { getShortcutBadgeLabelForSession, hasShortcutBadgeForSession, hideShortcutBadges } =
  useSidebarSessionShortcuts({
    collapsed,
    pinnedSessions,
    visibleGroups: renderedGroups,
    isPinnedSectionCollapsed,
    isGroupCollapsed,
    excludedSessionId: pinFlightSessionId,
    hasOwnOverlayOpen: () => spotlightStore.open || deleteDialogOpen.value,
    selectSession: (sessionId) => void sessionStore.selectSession(sessionId)
  })

const {
  canReorderProjectGroups,
  isProjectGroupReorderTarget,
  handleProjectGroupModelUpdate,
  canMoveProjectGroup,
  handleMoveProjectGroup,
  handleProjectGroupDragStart,
  handleProjectGroupDragEnd
} = useProjectGroupReorder({
  sessionStore,
  projectStore,
  sessionListRef,
  collapsed,
  normalizedSearchQuery: normalizedSessionSearchQuery,
  pinFlightSessionId,
  workspaceGroups,
  isProjectGroupDragging,
  isActiveProjectDirectoryGroup,
  getGroupIdentifier,
  getWorkspacePath,
  ensureSessionListFilled,
  onDragStart: hideShortcutBadges
})

const {
  isAddingWorkspace,
  revealedWorkspaceGroupId,
  workspaceOperationPending,
  archiveTargetWorkspace,
  isArchivingWorkspace,
  archiveWorkspaceDialogOpen,
  canOpenWorkspace,
  canSetDefaultWorkspace,
  isDefaultWorkspaceGroup,
  handleAddWorkspace,
  handleOpenWorkspace,
  handleSetDefaultWorkspace,
  requestWorkspaceArchive,
  handleArchiveWorkspaceConfirm
} = useSidebarWorkspaceActions({
  sessionStore,
  projectStore,
  sessionListRef,
  searchQuery: sessionSearchQuery,
  defaultChatWorkspacePath,
  defaultProjectPath: () => projectStore.defaultProjectPath,
  getWorkspaceEnvironment,
  t
})

const sessionRowsStatic = ref(sessionStore.loading || sessionStore.loadingMore)
// A collapsed chat section hides its rows with `display: none`, so their layout boxes measure as
// (0, 0) and TransitionGroup's FLIP would slide every row in from the viewport origin on expand.
// This watcher runs pre-flush, so the patch that re-shows the section already renders the rows
// static; motion resumes a frame later for regular list changes.
const chatSectionVisibilityStatic = ref(false)
const chatSessionRowsStatic = computed(
  () =>
    sessionRowsStatic.value ||
    chatSectionVisibilityStatic.value ||
    pinFlightSessionId.value !== null
)

watch(
  () => sessionStore.loading || sessionStore.loadingMore,
  (loading) => {
    if (loading) {
      sessionRowsStatic.value = true
      return
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!sessionStore.loading && !sessionStore.loadingMore) {
          sessionRowsStatic.value = false
        }
      })
    })
  },
  { immediate: true }
)

watch(
  () => chatSectionGroup.value !== null && isGroupCollapsed(chatSectionGroup.value),
  () => {
    chatSectionVisibilityStatic.value = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chatSectionVisibilityStatic.value = false
      })
    })
  }
)

const getGroupLabel = (group: SessionGroup) => (group.labelKey ? t(group.labelKey) : group.label)

const getShowMoreLabel = (group: SessionGroup) =>
  isGroupLoading(group)
    ? t('common.loading')
    : hasGroupLoadError(group)
      ? t('chat.sidebar.loadMoreFailed')
      : t('chat.sidebar.showMore')

const handleShowMoreGroup = async (group: SessionGroup, event: MouseEvent) => {
  const button = event.currentTarget as HTMLButtonElement
  const hadFocus = document.activeElement === button
  const list = sessionListRef.value
  const scrollTop = list?.scrollTop ?? 0
  let scrolled = false
  const onScroll = () => {
    scrolled = true
  }
  list?.addEventListener('scroll', onScroll, { once: true })
  const previousIds = new Set(getVisibleGroupSessions(group).map((session) => session.id))
  await showMoreGroupSessions(group)
  await nextTick()
  list?.removeEventListener('scroll', onScroll)
  if (!scrolled) restoreSessionListScrollTop(list, scrollTop)
  if (hadFocus && document.activeElement === document.body) {
    if (button.isConnected) {
      button.focus({ preventScroll: true })
      return
    }
    const currentGroup = visibleGroups.value.find((candidate) => candidate.id === group.id)
    const currentSessions = currentGroup ? getVisibleGroupSessions(currentGroup) : []
    const nextSession =
      currentSessions.find((session) => !previousIds.has(session.id)) ?? currentSessions.at(-1)
    const row = Array.from(
      sessionListRef.value?.querySelectorAll<HTMLElement>('[data-session-id]') ?? []
    ).find((element) => element.dataset.sessionId === nextSession?.id)
    row?.querySelector<HTMLElement>('.session-content')?.focus({ preventScroll: true })
  }
}

const handleWorkspaceGroupClick = (group: SessionGroup) => {
  if (isTrueEmptyWorkspaceGroup(group)) {
    void handleNewChatForProject(getWorkspacePath(group))
    return
  }

  toggleGroup(group)
}

const openSettings = () => {
  void settingsClient.openSettings()
}

const openWorkspaceSettings = () => {
  void settingsClient.openSettings({ routeName: 'settings-environments' })
}

const openPlugins = () => {
  void router?.push({ name: 'plugins' })
}

const navigateToChat = async () => {
  if (!router) {
    return
  }

  if (router.currentRoute.value.name !== 'chat') {
    await router.push({ name: 'chat' })
  }
}

const startNewChat = async (options: StartNewConversationOptions) => {
  try {
    await navigateToChat()
  } catch (error) {
    console.warn('[WindowSideBar] Failed to switch to chat route:', error)
  } finally {
    await sessionStore.startNewConversation(options)
  }
}

const handleNewChat = async () => {
  await startNewChat({ refresh: true })
}

const handleNewChatForProject = async (projectPath: string | null) => {
  await projectStore.selectProject(projectPath, 'manual')
  await startNewChat({ refresh: true, projectDir: projectPath })
}

const handleNewChatForWorkspaceGroup = async (group: SessionGroup) => {
  if (!canStartConversationInProjectGroup(group)) {
    return
  }
  await handleNewChatForProject(getWorkspacePath(group))
}

const handleAgentSelect = async (id: string | null) => {
  if (collapsed.value) {
    sidebarStore.setCollapsed(false)
  }

  const requestSeq = ++agentSwitchSeq

  agentSwitchQueue = agentSwitchQueue
    .then(async () => {
      const currentAgentId = sidebarSelectedAgentId.value
      const nextAgentId = id
      if (nextAgentId === currentAgentId) {
        return
      }

      if (sessionStore.hasActiveSession) {
        try {
          await sessionStore.closeSession()
        } catch (error) {
          console.warn(
            '[WindowSideBar] Failed to close active session before switching agent:',
            error
          )
          return
        }
      }

      if (requestSeq !== agentSwitchSeq) {
        return
      }

      agentStore.setSelectedAgent(nextAgentId)
    })
    .catch((error) => {
      console.warn('[WindowSideBar] Agent switch pipeline failed:', error)
    })

  await agentSwitchQueue
}

const handleSessionClick = async (session: { id: string }) => {
  try {
    await navigateToChat()
  } catch (error) {
    console.warn('[WindowSideBar] Failed to switch to chat route:', error)
  } finally {
    await sessionStore.selectSession(session.id)
  }
}

const openDeleteDialog = (session: UISession) => {
  deleteTargetSession.value = session
}

const handleDeleteConfirm = async () => {
  const targetSession = deleteTargetSession.value
  if (!targetSession) {
    return
  }

  try {
    await sessionStore.deleteSession(targetSession.id)
  } catch (error) {
    console.error(t('common.error.deleteChatFailed'), error)
  }

  deleteTargetSession.value = null
}

onMounted(() => {
  void projectStore.fetchEnvironments()
})
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}

.window-sidebar-shell {
  contain: layout style;
}

.window-sidebar-session-column {
  backface-visibility: hidden;
}

.session-list {
  overflow-anchor: none;
}

.chat-session-row-enter-active {
  transition:
    opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.chat-session-row-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.chat-session-row-move {
  transition: transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.chat-session-rows-static .chat-session-row-enter-active,
.chat-session-rows-static .chat-session-row-move {
  transition: none;
}

.chat-session-rows-static .chat-session-row-enter-from {
  opacity: 1;
  transform: translateY(0);
}

:deep(.sidebar-project-group-ghost) {
  opacity: 0.45;
}

:deep(.sidebar-project-group-chosen) {
  background: hsl(var(--accent) / 0.35);
}

button,
input {
  -webkit-app-region: no-drag;
}

:global(.sidebar-pin-flight) {
  transform: translateZ(0);
  backface-visibility: hidden;
}

:global(.sidebar-pin-flight .pin-button) {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: none;
  border-color: transparent;
  background-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  transform: translate3d(0, -50%, 0) scale(1);
  transition: none;
}

:global(.sidebar-pin-flight .session-content) {
  transform: translateX(var(--pin-text-shift)) !important;
}

@media (prefers-reduced-motion: reduce) {
  .window-sidebar-shell,
  .window-sidebar-session-column,
  .chat-session-row-enter-active,
  .chat-session-row-move {
    transition: none;
  }

  .chat-session-row-enter-from {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
