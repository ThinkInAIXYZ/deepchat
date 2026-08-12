<template>
  <TooltipProvider :delay-duration="200">
    <div
      data-testid="window-sidebar"
      class="window-sidebar-shell flex flex-row h-full shrink-0 overflow-hidden window-drag-region transition-[width] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
      :class="collapsed ? 'w-12' : 'w-[288px]'"
    >
      <!-- Left Column: Agent Icons (48px) -->
      <div class="window-no-drag-region flex flex-col items-center shrink-0 pt-2 pb-2 gap-1 w-12">
        <!-- All agents button -->
        <DcButton
          data-testid="sidebar-agent-all-button"
          data-agent-id="__all__"
          :data-selected="String(sidebarSelectedAgentId === null)"
          size="icon"
          icon="lucide:layers"
          icon-size="4"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          :tooltip="t('chat.sidebar.allAgents')"
          class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 text-foreground/80 hover:text-foreground/80"
          :class="
            sidebarSelectedAgentId === null
              ? 'bg-card/50 border-white/70 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
              : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
          "
          @click="handleAgentSelect(null)"
        />

        <div class="w-5 h-px bg-border my-1"></div>

        <!-- Agent icons -->
        <DcButton
          v-for="agent in agentStore.enabledAgents"
          :key="agent.id"
          data-testid="sidebar-agent-button"
          :data-agent-id="agent.id"
          :data-agent-type="agent.agentType ?? agent.type"
          :data-selected="String(sidebarSelectedAgentId === agent.id)"
          size="icon"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          :tooltip="agent.name"
          class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
          :class="
            sidebarSelectedAgentId === agent.id
              ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
              : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
          "
          @click="handleAgentSelect(agent.id)"
        >
          <AgentAvatar :agent="agent" class-name="w-4 h-4" />
        </DcButton>

        <!-- Spacer -->
        <div class="flex-1"></div>

        <!-- Bottom action buttons -->
        <div class="w-5 h-px bg-border my-1"></div>

        <DcButton
          size="icon"
          icon="lucide:search"
          icon-size="4"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          :tooltip="t('chat.spotlight.placeholder')"
          :title="t('chat.spotlight.placeholder')"
          class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 shadow-none text-foreground/80 hover:text-foreground/80"
          :class="
            spotlightStore.open
              ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
              : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10'
          "
          @click="spotlightStore.toggleSpotlight()"
        />

        <DcButton
          v-if="showRemoteControlButton"
          data-testid="remote-control-button"
          size="icon"
          icon="lucide:monitor-cloud"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          tooltip-content-class="whitespace-pre-line"
          :label="remoteControlTooltip"
          :tooltip="remoteControlTooltip"
          :title="remoteControlTooltip"
          class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 shadow-none"
          :class="remoteControlButtonClass"
          :icon-class="remoteControlIconClass"
          @click="openRemoteSettings"
        />

        <!-- Theme toggle -->
        <DcButton
          data-testid="window-sidebar-theme-toggle"
          size="icon"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          :tooltip="`${t('chat.sidebar.themeToggle')} · ${themeModeLabel}`"
          class="flex items-center justify-center w-9 h-9 rounded-xl bg-transparent border-none shadow-none text-foreground/90 hover:text-foreground/90 hover:bg-white/30 dark:hover:bg-white/10"
          @click="themeStore.cycleTheme()"
        >
          <span class="theme-icon-wrap">
            <Transition name="theme-icon">
              <Icon :key="themeIcon" :icon="themeIcon" class="theme-icon text-foreground/90" />
            </Transition>
          </span>
        </DcButton>

        <!-- Collapse toggle -->
        <DcButton
          :icon="collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'"
          size="icon"
          data-testid="window-sidebar-toggle"
          :label="collapsed ? t('chat.sidebar.expandSidebar') : t('chat.sidebar.collapseSidebar')"
          :tooltip="collapsed ? t('chat.sidebar.expandSidebar') : t('chat.sidebar.collapseSidebar')"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          class="w-9 h-9 rounded-xl bg-transparent border-none shadow-none text-foreground/80 hover:bg-white/30 hover:text-foreground/80 dark:hover:bg-white/10"
          @click="sidebarStore.toggleSidebar()"
        />

        <DcButton
          icon="lucide:ellipsis"
          size="icon"
          data-testid="app-settings-button"
          :label="t('routes.settings')"
          :tooltip="t('routes.settings')"
          tooltip-side="right"
          :tooltip-delay-duration="200"
          :title="t('routes.settings')"
          class="w-9 h-9 rounded-xl bg-transparent border-none shadow-none text-foreground/80 hover:bg-white/30 hover:text-foreground/80 dark:hover:bg-white/10"
          @click="openSettings"
        />
      </div>

      <!-- Right Column: Session List (240px) -->
      <div
        data-testid="window-sidebar-session-column"
        class="window-sidebar-session-column window-no-drag-region flex flex-col w-0 flex-1 min-w-0 transition-[opacity,transform] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
        :class="
          collapsed ? 'pointer-events-none translate-x-1.5 opacity-0' : 'translate-x-0 opacity-100'
        "
        :aria-hidden="collapsed ? 'true' : undefined"
        :inert="collapsed ? true : undefined"
      >
        <!-- Header and command list -->
        <div class="shrink-0 px-3 pb-3 pt-3">
          <div class="truncate px-2 text-sm font-semibold text-foreground">
            {{ selectedAgentName }}
          </div>

          <div class="mt-3 space-y-1">
            <div class="relative px-2">
              <Icon
                icon="lucide:search"
                class="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                v-model="sessionSearchQuery"
                data-testid="sidebar-session-search-input"
                type="search"
                :placeholder="t('chat.sidebar.searchPlaceholder')"
                :aria-label="t('chat.sidebar.searchAriaLabel')"
                class="h-8 pr-8 pl-8 text-sm"
                @keydown.esc.prevent="sessionSearchQuery = ''"
              />
            </div>

            <button
              data-testid="app-new-chat-button"
              type="button"
              class="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60"
              @click="handleNewChat"
            >
              <Icon icon="lucide:square-pen" class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ t('common.newChat') }}</span>
            </button>

            <button
              data-testid="app-search-command-button"
              type="button"
              class="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60"
              @click="spotlightStore.toggleSpotlight()"
            >
              <Icon icon="lucide:search" class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ t('chat.sidebar.searchCommand') }}</span>
            </button>

            <button
              data-testid="app-plugins-button"
              type="button"
              class="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm transition-colors hover:bg-accent/60"
              :class="pluginsRouteActive ? 'bg-accent/70 text-foreground' : 'text-foreground'"
              @click="openPlugins"
            >
              <Icon icon="lucide:blocks" class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ t('routes.plugins') }}</span>
            </button>
          </div>
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
          class="h-full border-0 py-10"
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
          class="session-list flex-1 overflow-y-auto px-1.5"
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

          <div v-if="chatSectionGroup" class="mt-4 rounded-lg bg-muted/30 p-1">
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
                v-for="session in chatSectionGroup.sessions"
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
                  class="group mt-2 flex w-full items-center gap-1 rounded-md pr-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-within:bg-accent/40 focus-within:text-foreground"
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
                      class="max-w-72 break-all"
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
                    class="flex items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100"
                    :class="
                      isTrueEmptyWorkspaceGroup(group)
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                    "
                    @click.stop="handleNewChatForProject(getWorkspacePath(group))"
                  />

                  <DropdownMenu v-if="isActiveProjectDirectoryGroup(group)">
                    <DropdownMenuTrigger as-child>
                      <DcButton
                        type="button"
                        size="icon-sm"
                        icon="lucide:ellipsis"
                        icon-size="3.5"
                        :tooltip="t('common.more')"
                        variant="ghost"
                        :aria-label="t('chat.sidebar.projectGroupActions')"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-40">
                      <DropdownMenuItem
                        :disabled="!canMoveProjectGroup(group, -1)"
                        @select="handleMoveProjectGroup(group, 'top')"
                      >
                        {{ t('chat.sidebar.moveProjectGroupTop') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="!canMoveProjectGroup(group, -1)"
                        @select="handleMoveProjectGroup(group, 'up')"
                      >
                        {{ t('chat.sidebar.moveProjectGroupUp') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="!canMoveProjectGroup(group, 1)"
                        @select="handleMoveProjectGroup(group, 'down')"
                      >
                        {{ t('chat.sidebar.moveProjectGroupDown') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="!canMoveProjectGroup(group, 1)"
                        @select="handleMoveProjectGroup(group, 'bottom')"
                      >
                        {{ t('chat.sidebar.moveProjectGroupBottom') }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid="window-sidebar-archive-workspace-menu-item"
                        :disabled="isArchivingWorkspace"
                        @select="requestWorkspaceArchive(group)"
                      >
                        {{ t('settings.environments.actions.archive') }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div v-show="!isGroupCollapsed(group)" class="space-y-0.5">
                  <WindowSideBarSessionItem
                    v-for="session in group.sessions"
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
    </div>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
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
import { useSessionListAutoFill } from '@/composables/sidebar/useSessionListAutoFill'
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

const sidebarSelectedAgentId = computed(() => {
  const activeSessionAgentId = sessionStore.activeSession?.agentId?.trim()
  if (sessionStore.hasActiveSession && activeSessionAgentId) {
    return activeSessionAgentId
  }

  const selectedAgentId =
    typeof agentStore.selectedAgentId === 'string' ? agentStore.selectedAgentId.trim() : ''
  return selectedAgentId || null
})

const selectedAgentName = computed(() => {
  if (sidebarSelectedAgentId.value === null) {
    return t('chat.sidebar.allAgents')
  }

  if (agentStore.selectedAgent?.id === sidebarSelectedAgentId.value) {
    return agentStore.selectedAgent.name
  }

  const matchedAgent = agentStore.enabledAgents.find(
    (agent) => agent.id === sidebarSelectedAgentId.value
  )
  return matchedAgent?.name ?? t('chat.sidebar.allAgents')
})

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
    visibleGroups,
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
  archiveTargetWorkspace,
  isArchivingWorkspace,
  archiveWorkspaceDialogOpen,
  handleAddWorkspace,
  requestWorkspaceArchive,
  handleArchiveWorkspaceConfirm
} = useSidebarWorkspaceActions({
  sessionStore,
  projectStore,
  sessionListRef,
  searchQuery: sessionSearchQuery,
  defaultChatWorkspacePath,
  getWorkspaceEnvironment,
  t
})

const sessionRowsStatic = ref(sessionStore.loading || sessionStore.loadingMore)
const chatSessionRowsStatic = computed(
  () => sessionRowsStatic.value || pinFlightSessionId.value !== null
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

const getGroupLabel = (group: SessionGroup) => (group.labelKey ? t(group.labelKey) : group.label)

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

const handleAgentSelect = async (id: string | null) => {
  if (collapsed.value) {
    sidebarStore.setCollapsed(false)
  }

  const requestSeq = ++agentSwitchSeq

  agentSwitchQueue = agentSwitchQueue
    .then(async () => {
      const currentAgentId = sidebarSelectedAgentId.value
      const nextAgentId = currentAgentId === id ? null : id
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

.theme-icon-wrap {
  display: grid;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
}

.theme-icon {
  /* 两个图标堆叠在同一网格单元，自动居中且不占额外空间 */
  grid-area: 1 / 1;
  width: 1.15rem;
  height: 1.15rem;
  /* 提升到独立合成层，让过渡跑在 GPU 合成线程上，
     避免被切换主题时的全局重绘阻塞而掉帧 */
  will-change: transform, opacity;
}

/* 形态变化交给 line-md 的线条流动动画；这里再叠加淡入缩放增强存在感 */
.theme-icon-enter-active {
  transition:
    opacity var(--dc-motion-default) var(--dc-ease-out-soft),
    transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.theme-icon-leave-active {
  transition:
    opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-fast) var(--dc-ease-out-express);
}

.theme-icon-enter-from {
  opacity: 0;
  transform: scale(0.4);
}

.theme-icon-leave-to {
  opacity: 0;
  transform: scale(0.7);
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

  .theme-icon-enter-active,
  .theme-icon-leave-active {
    transition: none;
  }
}
</style>
