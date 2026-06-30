<template>
  <TooltipProvider :delay-duration="200">
    <div
      data-testid="window-sidebar"
      class="window-sidebar-shell flex flex-row h-full shrink-0 overflow-hidden window-drag-region transition-[width] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
      :class="collapsed ? 'w-12' : 'w-[288px]'"
    >
      <!-- Left Column: Agent Icons (48px) -->
      <div class="window-no-drag-region flex flex-col items-center shrink-0 pt-2 pb-2 gap-1 w-12">
        <!-- All agents button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="sidebar-agent-all-button"
              data-agent-id="__all__"
              :data-selected="String(sidebarSelectedAgentId === null)"
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                sidebarSelectedAgentId === null
                  ? 'bg-card/50 border-white/70 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="handleAgentSelect(null)"
            >
              <Icon icon="lucide:layers" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('chat.sidebar.allAgents') }}</TooltipContent>
        </Tooltip>

        <div class="w-5 h-px bg-border my-1"></div>

        <!-- Agent icons -->
        <Tooltip v-for="agent in agentStore.enabledAgents" :key="agent.id">
          <TooltipTrigger as-child>
            <Button
              data-testid="sidebar-agent-button"
              :data-agent-id="agent.id"
              :data-agent-type="agent.agentType ?? agent.type"
              :data-selected="String(sidebarSelectedAgentId === agent.id)"
              size="icon"
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                sidebarSelectedAgentId === agent.id
                  ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="handleAgentSelect(agent.id)"
            >
              <AgentAvatar :agent="agent" class-name="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ agent.name }}</TooltipContent>
        </Tooltip>

        <!-- Spacer -->
        <div class="flex-1"></div>

        <!-- Bottom action buttons -->
        <div class="w-5 h-px bg-border my-1"></div>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 shadow-none"
              :class="
                spotlightStore.open
                  ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10'
              "
              :title="t('chat.spotlight.placeholder')"
              @click="spotlightStore.toggleSpotlight()"
            >
              <Icon icon="lucide:search" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('chat.spotlight.placeholder') }}</TooltipContent>
        </Tooltip>

        <Tooltip v-if="showRemoteControlButton">
          <TooltipTrigger as-child>
            <Button
              data-testid="remote-control-button"
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 shadow-none"
              :class="remoteControlButtonClass"
              :title="remoteControlTooltip"
              @click="openRemoteSettings"
            >
              <Icon icon="lucide:monitor-cloud" class="w-4 h-4" :class="remoteControlIconClass" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" class="whitespace-pre-line">
            {{ remoteControlTooltip }}
          </TooltipContent>
        </Tooltip>

        <!-- Theme toggle -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="window-sidebar-theme-toggle"
              class="flex items-center justify-center w-9 h-9 rounded-xl bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none"
              @click="themeStore.cycleTheme()"
            >
              <span class="theme-icon-wrap">
                <Transition name="theme-icon">
                  <Icon :key="themeIcon" :icon="themeIcon" class="theme-icon text-foreground/90" />
                </Transition>
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {{ t('chat.sidebar.themeToggle') }} · {{ themeModeLabel }}
          </TooltipContent>
        </Tooltip>

        <!-- Collapse toggle -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="window-sidebar-toggle"
              class="flex items-center justify-center w-9 h-9 rounded-xl bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none"
              @click="sidebarStore.toggleSidebar()"
            >
              <Icon
                :icon="collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'"
                class="w-4 h-4 text-foreground/80"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{
            collapsed ? t('chat.sidebar.expandSidebar') : t('chat.sidebar.collapseSidebar')
          }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="app-settings-button"
              class="flex items-center justify-center w-9 h-9 rounded-xl bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none"
              :title="t('routes.settings')"
              @click="openSettings"
            >
              <Icon icon="lucide:ellipsis" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('routes.settings') }}</TooltipContent>
        </Tooltip>
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
          <div
            v-for="row in 6"
            :key="`session-skeleton-${row}`"
            class="h-10 rounded-lg bg-muted/50 animate-pulse"
          ></div>
        </div>

        <!-- Empty state -->
        <div
          v-if="
            sessionStore.hasLoadedInitialPage &&
            pinnedSessions.length === 0 &&
            !chatSectionGroup &&
            workspaceGroups.length === 0
          "
          class="flex flex-col items-center justify-center h-full px-4 text-center"
        >
          <Icon icon="lucide:message-square-plus" class="w-8 h-8 text-muted-foreground/40 mb-3" />
          <p class="text-sm text-muted-foreground/60">
            {{
              sessionSearchQuery ? t('chat.sidebar.searchEmptyTitle') : t('chat.sidebar.emptyTitle')
            }}
          </p>
          <p class="text-xs text-muted-foreground/40 mt-1">
            {{
              sessionSearchQuery
                ? t('chat.sidebar.searchEmptyDescription')
                : t('chat.sidebar.emptyDescription')
            }}
          </p>
        </div>

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

          <div v-if="chatSectionGroup" class="pt-4">
            <div
              class="group flex w-full items-center gap-1 rounded-md pr-1 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-within:bg-accent/40 focus-within:text-foreground"
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
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    data-testid="window-sidebar-chat-new-button"
                    class="flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-all duration-150 hover:bg-accent/60 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                    :aria-label="t('common.newChat')"
                    @click.stop="handleNewChatForProject(defaultChatWorkspacePath || null)"
                  >
                    <Icon icon="lucide:plus" class="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ t('common.newChat') }}</TooltipContent>
              </Tooltip>
            </div>

            <div v-show="!isGroupCollapsed(chatSectionGroup)" class="space-y-0.5">
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
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 px-2 pb-1 pt-4">
            <div class="min-w-0 truncate text-xs font-semibold text-muted-foreground">
              {{ t('chat.sidebar.workspace') }}
            </div>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex size-7 items-center justify-center rounded-md transition-all duration-150"
                  :class="
                    sessionStore.groupMode === 'project'
                      ? 'bg-accent/80 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  "
                  @click="sessionStore.toggleGroupMode()"
                >
                  <Icon icon="lucide:folder-kanban" class="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{
                sessionStore.groupMode === 'project'
                  ? t('chat.sidebar.groupByDate')
                  : t('chat.sidebar.groupByProject')
              }}</TooltipContent>
            </Tooltip>
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
                  :class="isProjectGroupDragging ? 'pointer-events-none' : ''"
                >
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left"
                    :class="
                      isProjectGroupReorderTarget(group) && canReorderProjectGroups
                        ? 'sidebar-project-folder-target cursor-grab active:cursor-grabbing'
                        : ''
                    "
                    :data-group-id="getGroupIdentifier(group)"
                    :aria-expanded="!isGroupCollapsed(group)"
                    @click="toggleGroup(group)"
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
                  </button>

                  <Tooltip v-if="isProjectDirectoryGroup(group)">
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        data-testid="window-sidebar-project-new-button"
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all duration-150 hover:bg-accent/60 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        :aria-label="t('common.newChat')"
                        @click.stop="handleNewChatForProject(group.id)"
                      >
                        <Icon icon="lucide:plus" class="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{{ t('common.newChat') }}</TooltipContent>
                  </Tooltip>

                  <DropdownMenu
                    v-if="isProjectGroupReorderTarget(group) && canReorderProjectGroups"
                  >
                    <DropdownMenuTrigger as-child>
                      <button
                        type="button"
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                        :aria-label="t('chat.sidebar.projectGroupActions')"
                      >
                        <Icon icon="lucide:ellipsis" class="h-3.5 w-3.5" />
                      </button>
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

          <div
            v-if="sessionStore.loadingMore"
            class="px-2 py-3 text-center text-xs text-muted-foreground/70"
          >
            {{ t('common.loading') }}
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
        <Button variant="outline" @click="deleteDialogOpen = false">{{
          t('dialog.cancel')
        }}</Button>
        <Button variant="destructive" @click="handleDeleteConfirm">{{
          t('dialog.delete.confirm')
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Button } from '@shadcn/components/ui/button'
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
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { createSettingsClient } from '@api/SettingsClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import { createDeviceClient } from '@api/DeviceClient'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import { useSessionStore, type SessionGroup, type UISession } from '@/stores/ui/session'
import { useSpotlightStore } from '@/stores/ui/spotlight'
import type {
  RemoteChannel,
  RemoteChannelStatus,
  RemoteChannelDescriptor,
  RemoteRuntimeState
} from '@shared/presenter'
import AgentAvatar from './icons/AgentAvatar.vue'
import WindowSideBarSessionItem from './WindowSideBarSessionItem.vue'
import { useI18n } from 'vue-i18n'
import { useSidebarStore } from '@/stores/ui/sidebar'
import { useThemeStore } from '@/stores/theme'

type PinFeedbackMode = 'pinning' | 'unpinning'

const PIN_FEEDBACK_DURATION_MS: Record<PinFeedbackMode, number> = {
  pinning: 560,
  unpinning: 460
}
const PIN_FLIGHT_DURATION_MS = 460
const PIN_TARGET_SETTLE_MAX_FRAMES = 10
const PIN_TARGET_SETTLE_EPSILON_PX = 0.5
const SIDEBAR_SHORTCUT_BADGE_DELAY_MS = 500
const SIDEBAR_SHORTCUT_MAX_ROWS = 10
const CHAT_SECTION_GROUP_ID = '__chat__'
const NO_PROJECT_GROUP_ID = '__no_project__'
const getPinFeedbackMode = (nextPinned: boolean): PinFeedbackMode =>
  nextPinned ? 'pinning' : 'unpinning'

type SessionItemRegion = 'pinned' | 'grouped'
type ShortcutPlatform = 'mac' | 'other'
type ProjectGroupMoveTarget = 'top' | 'up' | 'down' | 'bottom'
type SessionItemRect = {
  left: number
  top: number
  width: number
  height: number
}

const settingsClient = createSettingsClient()
const remoteControlClient = createRemoteControlClient()
const deviceClient = createDeviceClient()
const { t } = useI18n()
const router = useRouter()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const sidebarStore = useSidebarStore()
const spotlightStore = useSpotlightStore()
const themeStore = useThemeStore()

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

const fallbackRemoteChannels: RemoteChannelDescriptor[] = [
  {
    id: 'telegram',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.telegram.title',
    descriptionKey: 'settings.remote.telegram.description',
    supportsPairing: true,
    supportsNotifications: true
  },
  {
    id: 'feishu',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.feishu.title',
    descriptionKey: 'settings.remote.feishu.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'qqbot',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.qqbot.title',
    descriptionKey: 'settings.remote.qqbot.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'discord',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.discord.title',
    descriptionKey: 'settings.remote.discord.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'weixin-ilink',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.weixinIlink.title',
    descriptionKey: 'settings.remote.weixinIlink.description',
    supportsPairing: false,
    supportsNotifications: false
  }
]

const collapsed = computed(() => sidebarStore.collapsed)
const sessionSearchQuery = ref('')
const pluginsRouteActive = computed(() =>
  String(router?.currentRoute?.value?.name ?? '').startsWith('plugins')
)
const remoteChannelDescriptors = ref<RemoteChannelDescriptor[]>(fallbackRemoteChannels)
const createRemoteStatusMap = (): Record<RemoteChannel, RemoteChannelStatus | null> => ({
  telegram: null,
  feishu: null,
  qqbot: null,
  discord: null,
  'weixin-ilink': null
})
const remoteControlStatus =
  ref<Record<RemoteChannel, RemoteChannelStatus | null>>(createRemoteStatusMap())
let agentSwitchSeq = 0
let agentSwitchQueue: Promise<void> = Promise.resolve()
let remoteControlStatusTimer: ReturnType<typeof setInterval> | null = null
let pinFeedbackTimer: number | null = null
let sessionListScrollFrame: number | null = null
let sessionListFillFrame: number | null = null
let sessionListResizeObserver: ResizeObserver | null = null
let shortcutBadgeTimer: number | null = null
const shortcutPlatform = ref<ShortcutPlatform>(
  navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
)
const shortcutModifierDown = ref(false)
const showShortcutBadges = ref(false)
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

const implementedRemoteChannels = computed(() =>
  remoteChannelDescriptors.value
    .filter((descriptor) => descriptor.implemented)
    .map((descriptor) => descriptor.id)
)
const getRemoteChannelStatus = (channel: RemoteChannel) => remoteControlStatus.value[channel]
const showRemoteControlButton = computed(() =>
  implementedRemoteChannels.value.some((channel) =>
    Boolean(getRemoteChannelStatus(channel)?.enabled)
  )
)
const firstEnabledRemoteChannel = computed<RemoteChannel | null>(
  () =>
    implementedRemoteChannels.value.find((channel) =>
      Boolean(getRemoteChannelStatus(channel)?.enabled)
    ) ?? null
)
const aggregatedRemoteControlState = computed<RemoteRuntimeState>(() => {
  const states = implementedRemoteChannels.value
    .map((channel) => getRemoteChannelStatus(channel))
    .filter((status) => status?.enabled)
    .map((status) => status?.state as RemoteRuntimeState)

  if (states.length === 0) {
    return 'disabled'
  }
  if (states.includes('error')) {
    return 'error'
  }
  if (states.includes('backoff')) {
    return 'backoff'
  }
  if (states.includes('starting')) {
    return 'starting'
  }
  if (states.includes('running')) {
    return 'running'
  }
  if (states.includes('stopped')) {
    return 'stopped'
  }
  return 'disabled'
})
const remoteControlTooltip = computed(() => {
  return implementedRemoteChannels.value
    .map((channel) => {
      const descriptor = remoteChannelDescriptors.value.find((item) => item.id === channel)
      const title = descriptor ? t(descriptor.titleKey) : channel
      const status = getRemoteChannelStatus(channel)
      const statusText =
        status?.enabled && status.state
          ? t(`chat.sidebar.remoteControlStatus.${status.state}`)
          : t('chat.sidebar.remoteControlDisabled')
      return `${title}: ${statusText}`
    })
    .join('\n')
})
const remoteControlButtonClass = computed(() => {
  const state = aggregatedRemoteControlState.value

  if (state === 'error') {
    return 'border-red-500/40 bg-red-500/10 hover:bg-red-500/15'
  }

  return 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15'
})
const remoteControlIconClass = computed(() => {
  const state = aggregatedRemoteControlState.value

  if (state === 'error') {
    return 'text-red-600 dark:text-red-400'
  }

  return ['text-emerald-600 dark:text-emerald-400', state === 'starting' ? 'animate-pulse' : '']
})

const isPinnedSectionCollapsed = ref(false)
const collapsedGroupIds = ref<Set<string>>(new Set())
const normalizedSessionSearchQuery = computed(() => sessionSearchQuery.value.trim().toLowerCase())
const matchesSessionSearch = (session: UISession) => {
  if (!normalizedSessionSearchQuery.value) {
    return true
  }

  return session.title.toLowerCase().includes(normalizedSessionSearchQuery.value)
}
const pinFlightSessionId = ref<string | null>(null)
const pinDockedSessionId = ref<string | null>(null)
const pinFeedbackSessionId = ref<string | null>(null)
const pinFeedbackMode = ref<PinFeedbackMode | null>(null)
const isProjectGroupDragging = ref(false)
const projectGroupDragScrollTop = ref<number | null>(null)
const projectEnvironmentMetadataReady = ref(false)
const pinnedSessions = computed(() =>
  sessionStore.getPinnedSessions(sidebarSelectedAgentId.value).filter(matchesSessionSearch)
)
const baseFilteredGroups = computed(() =>
  sessionStore
    .getFilteredGroups(sidebarSelectedAgentId.value)
    .map((group) => ({
      id: group.id,
      label: group.label,
      labelKey: group.labelKey,
      sessions: group.sessions.filter(matchesSessionSearch)
    }))
    .filter((group) => group.sessions.length > 0)
)
const projectOrderIndex = computed(
  () => new Map(projectStore.environments.map((environment, index) => [environment.path, index]))
)
const archivedProjectPathSet = computed(
  () => new Set(projectStore.archivedEnvironments.map((environment) => environment.path))
)
const normalizeProjectPath = (projectPath: string | null | undefined) =>
  projectPath?.trim().replace(/[\\/]+$/, '') ?? ''
const defaultChatWorkspacePath = computed(() =>
  normalizeProjectPath(projectStore.defaultChatWorkspacePath)
)
const isChatSession = (session: UISession) => {
  const projectPath = normalizeProjectPath(session.projectDir)
  return (
    projectPath.length === 0 ||
    (defaultChatWorkspacePath.value.length > 0 && projectPath === defaultChatWorkspacePath.value)
  )
}
const isWorkspaceSession = (session: UISession) => !isChatSession(session)
const isChatProjectGroup = (group: SessionGroup) =>
  group.id === NO_PROJECT_GROUP_ID ||
  (defaultChatWorkspacePath.value.length > 0 &&
    normalizeProjectPath(group.id) === defaultChatWorkspacePath.value)
const isProjectDirectoryGroup = (group: SessionGroup) =>
  sessionStore.groupMode === 'project' &&
  group.id !== NO_PROJECT_GROUP_ID &&
  !group.labelKey &&
  !isChatProjectGroup(group)
const isActiveProjectDirectoryGroup = (group: SessionGroup) =>
  isProjectDirectoryGroup(group) && !archivedProjectPathSet.value.has(group.id)
const getProjectGroupRank = (group: SessionGroup) => {
  if (!isProjectDirectoryGroup(group)) {
    return 2
  }

  return archivedProjectPathSet.value.has(group.id) ? 1 : 0
}
const compareProjectGroups = (left: SessionGroup, right: SessionGroup) => {
  const leftRank = getProjectGroupRank(left)
  const rightRank = getProjectGroupRank(right)

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  if (leftRank !== 0) {
    return 0
  }

  const leftOrder = projectOrderIndex.value.get(left.id) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = projectOrderIndex.value.get(right.id) ?? Number.MAX_SAFE_INTEGER
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder
  }

  return 0
}
const filteredGroups = computed(() => {
  const groups = baseFilteredGroups.value
  if (sessionStore.groupMode !== 'project') {
    return groups
  }

  return groups
    .map((group, index) => ({ group, index }))
    .sort(
      (left, right) => compareProjectGroups(left.group, right.group) || left.index - right.index
    )
    .map(({ group }) => group)
})
const compareSidebarSessions = (left: UISession, right: UISession) => {
  const leftUpdatedAt = Number.isFinite(left.updatedAt) ? left.updatedAt : 0
  const rightUpdatedAt = Number.isFinite(right.updatedAt) ? right.updatedAt : 0
  if (leftUpdatedAt !== rightUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt
  }

  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
}
const sortSidebarSessions = (sessions: UISession[]) => [...sessions].sort(compareSidebarSessions)
const chatSessions = computed(() =>
  sortSidebarSessions(
    baseFilteredGroups.value.flatMap((group) => {
      if (sessionStore.groupMode === 'project') {
        return isChatProjectGroup(group) ? group.sessions : []
      }

      return group.sessions.filter(isChatSession)
    })
  )
)
const chatSectionGroup = computed<SessionGroup | null>(() => {
  const sessions = chatSessions.value
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
  if (sessionStore.groupMode === 'project') {
    return filteredGroups.value.filter(isProjectDirectoryGroup)
  }

  return baseFilteredGroups.value
    .map((group) => ({
      ...group,
      sessions: sortSidebarSessions(group.sessions.filter(isWorkspaceSession))
    }))
    .filter((group) => group.sessions.length > 0)
})
const visibleGroups = computed(() => [
  ...(chatSectionGroup.value ? [chatSectionGroup.value] : []),
  ...workspaceGroups.value
])
const projectReorderableGroups = computed(() =>
  workspaceGroups.value.filter(isActiveProjectDirectoryGroup)
)
const canReorderProjectGroups = computed(
  () =>
    !collapsed.value &&
    sessionStore.groupMode === 'project' &&
    normalizedSessionSearchQuery.value.length === 0 &&
    !pinFlightSessionId.value &&
    projectEnvironmentMetadataReady.value &&
    sessionStore.hasLoadedInitialPage &&
    !sessionStore.loading &&
    projectReorderableGroups.value.length > 1
)
const sessionListRef = ref<HTMLElement | null>(null)
const deleteTargetSession = ref<UISession | null>(null)

const deleteDialogOpen = computed({
  get: () => deleteTargetSession.value !== null,
  set: (open: boolean) => {
    if (!open) {
      deleteTargetSession.value = null
    }
  }
})

const getGroupIdentifier = (group: SessionGroup) => group.id

const getGroupLabel = (group: SessionGroup) => (group.labelKey ? t(group.labelKey) : group.label)
const getGroupIcon = (group: SessionGroup) =>
  isGroupCollapsed(group) ? 'lucide:folder-closed' : 'lucide:folder-open'

const isGroupCollapsed = (group: SessionGroup) =>
  collapsedGroupIds.value.has(getGroupIdentifier(group))

const visibleShortcutSessions = computed<UISession[]>(() => {
  if (collapsed.value) {
    return []
  }

  const sessions: UISession[] = []

  if (!isPinnedSectionCollapsed.value) {
    sessions.push(...pinnedSessions.value)
  }

  for (const group of visibleGroups.value) {
    if (!isGroupCollapsed(group)) {
      sessions.push(...group.sessions)
    }
  }

  return sessions
    .filter((session) => session.id !== pinFlightSessionId.value)
    .slice(0, SIDEBAR_SHORTCUT_MAX_ROWS)
})

const getShortcutDigitForIndex = (index: number) => (index === 9 ? '0' : String(index + 1))

const getShortcutIndexForDigit = (digit: string) => (digit === '0' ? 9 : Number(digit) - 1)

const getShortcutBadgeLabelForIndex = (index: number) => {
  const digit = getShortcutDigitForIndex(index)
  return shortcutPlatform.value === 'mac' ? `⌘${digit}` : `Alt+${digit}`
}

const shortcutBadgeLabelBySessionId = computed(() => {
  const labels = new Map<string, string>()

  visibleShortcutSessions.value.forEach((session, index) => {
    labels.set(session.id, getShortcutBadgeLabelForIndex(index))
  })

  return labels
})

const getShortcutBadgeLabelForSession = (sessionId: string) =>
  shortcutBadgeLabelBySessionId.value.get(sessionId) ?? null

const hasShortcutBadgeForSession = (sessionId: string) =>
  showShortcutBadges.value && shortcutBadgeLabelBySessionId.value.has(sessionId)

const scheduleSessionListFillCheck = () => {
  if (sessionListFillFrame !== null) {
    return
  }

  sessionListFillFrame = window.requestAnimationFrame(() => {
    sessionListFillFrame = null
    void ensureSessionListFilled()
  })
}

const togglePinnedSection = () => {
  isPinnedSectionCollapsed.value = !isPinnedSectionCollapsed.value
  scheduleSessionListFillCheck()
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
  scheduleSessionListFillCheck()
}

const isProjectGroupReorderTarget = (group: SessionGroup) => isActiveProjectDirectoryGroup(group)

const getCurrentProjectOrderPaths = () => {
  const environmentPaths = projectStore.environments.map((environment) => environment.path)
  return environmentPaths.length > 0
    ? environmentPaths
    : projectReorderableGroups.value.map((group) => group.id)
}

const commitVisibleProjectGroupOrder = async (nextVisiblePaths: string[]) => {
  const currentOrder = getCurrentProjectOrderPaths()
  const previousVisiblePaths = projectReorderableGroups.value.map((group) => group.id)
  const previousVisiblePathSet = new Set(previousVisiblePaths)
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

  const nextVisiblePaths = nextGroups.filter(isActiveProjectDirectoryGroup).map((group) => group.id)
  void commitVisibleProjectGroupOrder(nextVisiblePaths).catch((error) => {
    console.warn('[WindowSideBar] Failed to reorder project groups:', error)
  })
}

const canMoveProjectGroup = (group: SessionGroup, delta: -1 | 1) => {
  if (!canReorderProjectGroups.value || !isProjectGroupReorderTarget(group)) {
    return false
  }

  const groups = projectReorderableGroups.value
  const index = groups.findIndex((candidate) => candidate.id === group.id)
  if (index < 0) {
    return false
  }

  return delta < 0 ? index > 0 : index < groups.length - 1
}

const handleMoveProjectGroup = (group: SessionGroup, target: ProjectGroupMoveTarget) => {
  if (!canReorderProjectGroups.value || !isProjectGroupReorderTarget(group)) {
    return
  }

  const paths = projectReorderableGroups.value.map((candidate) => candidate.id)
  const currentIndex = paths.indexOf(group.id)
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
  hideShortcutBadges()
}

const handleProjectGroupDragEnd = () => {
  void nextTick(() => {
    restoreSessionListScroll(projectGroupDragScrollTop.value)
    projectGroupDragScrollTop.value = null
    isProjectGroupDragging.value = false
    void ensureSessionListFilled()
  })
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
    if (isProjectGroupDragging.value) {
      return
    }

    const validGroupIds = new Set(groups.map(getGroupIdentifier))
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

const openSettings = () => {
  void settingsClient.openSettings()
}

const openPlugins = () => {
  void router?.push({ name: 'plugins' })
}

const openRemoteSettings = async () => {
  if (router?.hasRoute?.('plugins-detail') && firstEnabledRemoteChannel.value) {
    await router.push({
      name: 'plugins-detail',
      params: { pluginId: `remote:${firstEnabledRemoteChannel.value}` }
    })
    return
  }

  await settingsClient.openSettings({ routeName: 'settings-remote' })
}

const refreshRemoteControlStatus = async () => {
  try {
    remoteChannelDescriptors.value =
      (await remoteControlClient.listRemoteChannels()) ?? fallbackRemoteChannels

    const channels = remoteChannelDescriptors.value
      .filter((descriptor) => descriptor.implemented)
      .map((descriptor) => descriptor.id)
    const statuses = await Promise.all(
      channels.map(async (channel) => ({
        channel,
        status: await remoteControlClient.getChannelStatus(channel)
      }))
    )

    if (statuses.every((entry) => entry.status !== null)) {
      remoteControlStatus.value = statuses.reduce(
        (acc, entry) => ({
          ...acc,
          [entry.channel]: entry.status as RemoteChannelStatus
        }),
        createRemoteStatusMap()
      )
      return
    }

    remoteControlStatus.value = {
      ...createRemoteStatusMap(),
      telegram: await remoteControlClient.getTelegramStatus(),
      'weixin-ilink': await remoteControlClient.getWeixinIlinkStatus()
    }
  } catch (error) {
    console.warn('[WindowSideBar] Failed to refresh remote control status:', error)
  }
}

const refreshProjectEnvironmentMetadata = async () => {
  try {
    await projectStore.fetchEnvironments()
    projectEnvironmentMetadataReady.value = true
  } catch (error) {
    console.warn('[WindowSideBar] Failed to refresh project environment metadata:', error)
  }
}

const navigateToChat = async () => {
  if (!router) {
    return
  }

  if (router.currentRoute.value.name !== 'chat') {
    await router.push({ name: 'chat' })
  }
}

const handleNewChat = async () => {
  try {
    await navigateToChat()
  } catch (error) {
    console.warn('[WindowSideBar] Failed to switch to chat route:', error)
  } finally {
    await sessionStore.startNewConversation({ refresh: true })
  }
}

const handleNewChatForProject = async (projectPath: string | null) => {
  await projectStore.selectProject(projectPath, 'manual')
  await handleNewChat()
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

const loadShortcutPlatform = async () => {
  try {
    const deviceInfo = await deviceClient.getDeviceInfo()
    shortcutPlatform.value = deviceInfo.platform === 'darwin' ? 'mac' : 'other'
  } catch (error) {
    console.warn('[WindowSideBar] Failed to resolve shortcut platform:', error)
  }
}

const isEditableShortcutTarget = (target: EventTarget | null) => {
  const element = target instanceof HTMLElement ? target : null
  if (!element) {
    return false
  }

  return Boolean(
    element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  )
}

const hasKeyboardOwningOverlay = () =>
  spotlightStore.open ||
  deleteDialogOpen.value ||
  document.querySelector('.chat-search-bar') !== null ||
  document.querySelector('[role="dialog"][aria-modal="true"]') !== null

const shouldIgnoreSidebarShortcutEvent = (event: KeyboardEvent) =>
  collapsed.value || isEditableShortcutTarget(event.target) || hasKeyboardOwningOverlay()

const getPlatformModifierKey = () => (shortcutPlatform.value === 'mac' ? 'Meta' : 'Alt')

const isPlatformModifierPressed = (event: KeyboardEvent) =>
  shortcutPlatform.value === 'mac' ? event.metaKey : event.altKey

const isPlatformModifierOnlyKeydown = (event: KeyboardEvent) => {
  if (event.repeat || shouldIgnoreSidebarShortcutEvent(event)) {
    return false
  }

  if (shortcutPlatform.value === 'mac') {
    return (
      event.key === 'Meta' && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
    )
  }

  return event.key === 'Alt' && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
}

const isSidebarShortcutDigitEvent = (event: KeyboardEvent) => {
  if (event.repeat || !/^[0-9]$/.test(event.key) || shouldIgnoreSidebarShortcutEvent(event)) {
    return false
  }

  if (shortcutPlatform.value === 'mac') {
    return event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
  }

  return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
}

const clearShortcutBadgeTimer = () => {
  if (shortcutBadgeTimer !== null) {
    window.clearTimeout(shortcutBadgeTimer)
    shortcutBadgeTimer = null
  }
}

const hideShortcutBadges = () => {
  clearShortcutBadgeTimer()
  shortcutModifierDown.value = false
  showShortcutBadges.value = false
}

const startShortcutBadgeTimer = () => {
  if (shortcutBadgeTimer !== null || showShortcutBadges.value) {
    return
  }

  shortcutModifierDown.value = true
  shortcutBadgeTimer = window.setTimeout(() => {
    shortcutBadgeTimer = null

    if (
      shortcutModifierDown.value &&
      !collapsed.value &&
      !hasKeyboardOwningOverlay() &&
      visibleShortcutSessions.value.length > 0
    ) {
      showShortcutBadges.value = true
    }
  }, SIDEBAR_SHORTCUT_BADGE_DELAY_MS)
}

const selectShortcutSession = (digit: string) => {
  const shortcutIndex = getShortcutIndexForDigit(digit)
  const targetSession = visibleShortcutSessions.value[shortcutIndex]

  if (targetSession) {
    void sessionStore.selectSession(targetSession.id)
  }
}

const handleWindowShortcutKeydown = (event: KeyboardEvent) => {
  if (isPlatformModifierOnlyKeydown(event)) {
    if (shortcutPlatform.value !== 'mac') {
      event.preventDefault()
    }
    startShortcutBadgeTimer()
    return
  }

  if (shortcutBadgeTimer !== null && event.key !== getPlatformModifierKey()) {
    clearShortcutBadgeTimer()
  }

  if (!isSidebarShortcutDigitEvent(event)) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  selectShortcutSession(event.key)
}

const handleWindowShortcutKeyup = (event: KeyboardEvent) => {
  const modifierKey = getPlatformModifierKey()
  if (event.key === modifierKey || !isPlatformModifierPressed(event)) {
    if (shortcutPlatform.value !== 'mac' && event.key === modifierKey) {
      event.preventDefault()
    }
    hideShortcutBadges()
  }
}

const handleWindowShortcutBlur = () => {
  hideShortcutBadges()
}

const handleDocumentVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    hideShortcutBadges()
  }
}

watch(collapsed, (isCollapsed) => {
  if (isCollapsed) {
    hideShortcutBadges()
  }
})

const openDeleteDialog = (session: UISession) => {
  deleteTargetSession.value = session
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const clearPinFeedback = () => {
  if (pinFeedbackTimer) {
    window.clearTimeout(pinFeedbackTimer)
    pinFeedbackTimer = null
  }

  pinFeedbackSessionId.value = null
  pinFeedbackMode.value = null
}

const applyPinFeedback = (sessionId: string, nextPinned: boolean) => {
  if (prefersReducedMotion()) {
    clearPinFeedback()
    return
  }

  if (pinFeedbackTimer) {
    window.clearTimeout(pinFeedbackTimer)
  }

  pinFeedbackSessionId.value = sessionId
  const mode = getPinFeedbackMode(nextPinned)
  pinFeedbackMode.value = mode
  pinFeedbackTimer = window.setTimeout(() => {
    pinFeedbackSessionId.value = null
    pinFeedbackMode.value = null
    pinFeedbackTimer = null
  }, PIN_FEEDBACK_DURATION_MS[mode])
}

const commitPinToggle = async (session: UISession, nextPinned: boolean, withFeedback = true) => {
  await sessionStore.toggleSessionPinned(session.id, nextPinned)
  if (withFeedback) {
    applyPinFeedback(session.id, nextPinned)
  }
  await nextTick()
}

const waitForAnimationFrame = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })

const restoreSessionListScroll = (scrollTop: number | null) => {
  if (scrollTop === null || !sessionListRef.value) {
    return
  }

  sessionListRef.value.scrollTop = scrollTop
}

const performSessionListScrollCheck = () => {
  const listElement = sessionListRef.value
  if (
    !listElement ||
    isProjectGroupDragging.value ||
    sessionStore.loadingMore ||
    !sessionStore.hasMore
  ) {
    return
  }

  const distanceToBottom =
    listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight

  if (distanceToBottom <= 96) {
    void sessionStore.loadNextPage()
  }
}

const handleSessionListScroll = () => {
  if (sessionListScrollFrame !== null) {
    return
  }

  sessionListScrollFrame = window.requestAnimationFrame(() => {
    sessionListScrollFrame = null
    performSessionListScrollCheck()
  })
}

// 当首屏返回的 regular 会话不足以填满列表容器时，不会产生滚动条，
// `@scroll` 永远不触发，`loadNextPage` 也就永远不会被调用（issue #1762）。
// 这里在加载/过滤变化后主动检测视口是否被填满，未满且仍有更多数据时继续加载。
let isFillingSessionList = false
const ensureSessionListFilled = async () => {
  if (isFillingSessionList || isProjectGroupDragging.value || collapsed.value) {
    return
  }
  isFillingSessionList = true
  try {
    // 轮数上限兜底，避免异常情况下（如 cursor 不推进）陷入死循环。
    const MAX_FILL_ROUNDS = 50
    for (let round = 0; round < MAX_FILL_ROUNDS; round += 1) {
      await nextTick()
      const listElement = sessionListRef.value
      if (
        !listElement ||
        isProjectGroupDragging.value ||
        collapsed.value ||
        !sessionStore.hasMore ||
        sessionStore.loadingMore ||
        sessionStore.loading
      ) {
        return
      }
      // 内容高度已超过容器（存在可滚动空间），交还给滚动事件处理后续分页。
      if (listElement.scrollHeight > listElement.clientHeight + 1) {
        return
      }
      const beforeCount = sessionStore.sessions.length
      const beforeHasMore = sessionStore.hasMore
      await sessionStore.loadNextPage()
      if (
        beforeHasMore === sessionStore.hasMore &&
        sessionStore.hasMore &&
        sessionStore.sessions.length <= beforeCount
      ) {
        return
      }
    }
  } finally {
    isFillingSessionList = false
  }
}

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

// 会话列表内容、过滤、分组折叠或容器高度变化后，若视口未被填满则继续加载，
// 保证「滚动加载更多」在首屏内容过少或可见内容被过滤/折叠后也能启动（issue #1762）。
watch(
  [
    () => sessionStore.sessions.length,
    () => sessionStore.hasMore,
    () => sessionStore.loading,
    () => sessionStore.groupMode,
    sidebarSelectedAgentId,
    normalizedSessionSearchQuery,
    visibleSessionFingerprint,
    collapsed
  ],
  () => {
    scheduleSessionListFillCheck()
  },
  { immediate: true }
)

const getSessionItemElement = (sessionId: string, region: SessionItemRegion) =>
  document.querySelector<HTMLElement>(
    `.session-item[data-session-id="${sessionId}"][data-session-region="${region}"]`
  )

const getPinPlaceholderElement = (sessionId: string, region: SessionItemRegion) =>
  document.querySelector<HTMLElement>(
    `.session-item[data-session-id="${sessionId}"][data-session-region="${region}"][data-pin-placeholder="true"]`
  )

const captureSessionItemRect = (element: HTMLElement | null): SessionItemRect | null => {
  if (!element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return null
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
}

const areSessionItemRectsEqual = (left: SessionItemRect, right: SessionItemRect) =>
  Math.abs(left.left - right.left) <= PIN_TARGET_SETTLE_EPSILON_PX &&
  Math.abs(left.top - right.top) <= PIN_TARGET_SETTLE_EPSILON_PX &&
  Math.abs(left.width - right.width) <= PIN_TARGET_SETTLE_EPSILON_PX &&
  Math.abs(left.height - right.height) <= PIN_TARGET_SETTLE_EPSILON_PX

const waitForPinTargetPlaceholder = async (
  sessionId: string,
  region: SessionItemRegion
): Promise<{ element: HTMLElement; rect: SessionItemRect } | null> => {
  let previousRect: SessionItemRect | null = null

  for (let frame = 0; frame < PIN_TARGET_SETTLE_MAX_FRAMES; frame += 1) {
    await waitForAnimationFrame()
    const element = getPinPlaceholderElement(sessionId, region)
    const rect = captureSessionItemRect(element)

    if (!element || !rect) {
      previousRect = null
      continue
    }

    if (previousRect && areSessionItemRectsEqual(previousRect, rect)) {
      return { element, rect }
    }

    previousRect = rect
  }

  const fallbackElement =
    getPinPlaceholderElement(sessionId, region) ?? getSessionItemElement(sessionId, region)
  const fallbackRect = captureSessionItemRect(fallbackElement)
  if (!fallbackElement || !fallbackRect) {
    return null
  }

  return {
    element: fallbackElement,
    rect: fallbackRect
  }
}

const getPinFlightAnimationOptions = (nextPinned: boolean) =>
  nextPinned
    ? {
        duration: PIN_FLIGHT_DURATION_MS,
        easing: 'cubic-bezier(0.18, 0.92, 0.22, 1)'
      }
    : {
        duration: PIN_FLIGHT_DURATION_MS + 20,
        easing: 'cubic-bezier(0.24, 0.84, 0.28, 1)'
      }

const createPinFlightKeyframes = (
  deltaX: number,
  deltaY: number,
  scaleX: number,
  scaleY: number,
  nextPinned: boolean
): Keyframe[] => {
  const leadX = nextPinned ? deltaX * 0.82 : deltaX * 0.9
  const leadY = nextPinned ? deltaY * 0.78 : deltaY * 0.86
  const leadScaleX = nextPinned ? 1.018 : 1.008
  const leadScaleY = nextPinned ? 1.018 : 1.008

  return [
    {
      transform: 'translate3d(0, 0, 0) scale(1)',
      opacity: 1,
      offset: 0
    },
    {
      transform: `translate3d(${leadX}px, ${leadY}px, 0) scale(${leadScaleX}, ${leadScaleY})`,
      opacity: 1,
      offset: nextPinned ? 0.68 : 0.74
    },
    {
      transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
      opacity: 1,
      offset: 1
    }
  ]
}

const createPinFlightClone = (sourceElement: HTMLElement, sourceRect: DOMRect) => {
  const clone = sourceElement.cloneNode(true) as HTMLElement

  clone.removeAttribute('style')
  clone.classList.remove('is-hero-hidden')
  delete clone.dataset.pinFx
  delete clone.dataset.heroHidden
  clone.setAttribute('aria-hidden', 'true')
  clone.classList.add('sidebar-pin-flight')
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${sourceRect.left}px`,
    top: `${sourceRect.top}px`,
    width: `${sourceRect.width}px`,
    height: `${sourceRect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transformOrigin: 'top left',
    willChange: 'transform',
    contain: 'layout style paint'
  })

  return clone
}

const animatePinFlight = async (session: UISession, nextPinned: boolean) => {
  const sourceRegion: SessionItemRegion = session.isPinned ? 'pinned' : 'grouped'
  const targetRegion: SessionItemRegion = nextPinned ? 'pinned' : 'grouped'
  const sourceElement = getSessionItemElement(session.id, sourceRegion)
  const sourceRect = sourceElement?.getBoundingClientRect()
  const preservedScrollTop = sessionListRef.value?.scrollTop ?? null

  if (!sourceElement || !sourceRect || sourceRect.width === 0 || sourceRect.height === 0) {
    await commitPinToggle(session, nextPinned)
    return
  }

  const clone = createPinFlightClone(sourceElement, sourceRect)
  document.body.appendChild(clone)
  pinFlightSessionId.value = session.id
  if (!nextPinned) {
    pinDockedSessionId.value = session.id
  }
  await nextTick()

  try {
    await waitForAnimationFrame()
    clone.dataset.pinState = 'docked'
    await waitForAnimationFrame()

    await commitPinToggle(session, nextPinned, false)
    restoreSessionListScroll(preservedScrollTop)
    await waitForAnimationFrame()
    restoreSessionListScroll(preservedScrollTop)
    await waitForAnimationFrame()

    const targetSettledState = await waitForPinTargetPlaceholder(session.id, targetRegion)
    const targetElement = targetSettledState?.element
    const targetRect = targetSettledState?.rect

    if (!targetElement || !targetRect) {
      clone.remove()
      if (pinDockedSessionId.value === session.id) {
        pinDockedSessionId.value = null
      }
      applyPinFeedback(session.id, nextPinned)
      pinFlightSessionId.value = null
      await nextTick()
      return
    }

    const deltaX = targetRect.left - sourceRect.left
    const deltaY = targetRect.top - sourceRect.top
    const scaleX = targetRect.width / sourceRect.width
    const scaleY = targetRect.height / sourceRect.height

    const animation = clone.animate(
      createPinFlightKeyframes(deltaX, deltaY, scaleX, scaleY, nextPinned),
      {
        ...getPinFlightAnimationOptions(nextPinned),
        fill: 'forwards'
      }
    )

    await animation.finished.catch(() => undefined)
    clone.remove()
    if (pinDockedSessionId.value === session.id) {
      pinDockedSessionId.value = null
    }
    applyPinFeedback(session.id, nextPinned)
    pinFlightSessionId.value = null
    await nextTick()
  } finally {
    if (pinDockedSessionId.value === session.id) {
      pinDockedSessionId.value = null
    }
    pinFlightSessionId.value = null
    clone.remove()
  }
}

const handleTogglePin = async (session: UISession) => {
  const nextPinned = !session.isPinned

  try {
    if (prefersReducedMotion()) {
      await commitPinToggle(session, nextPinned)
      return
    }

    await animatePinFlight(session, nextPinned)
  } catch (error) {
    console.error('Failed to toggle pin status:', error)
  }
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
  void refreshProjectEnvironmentMetadata()
  void loadShortcutPlatform()
  window.addEventListener('keydown', handleWindowShortcutKeydown)
  window.addEventListener('keyup', handleWindowShortcutKeyup)
  window.addEventListener('blur', handleWindowShortcutBlur)
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange)

  if (typeof ResizeObserver !== 'undefined') {
    sessionListResizeObserver = new ResizeObserver(() => {
      scheduleSessionListFillCheck()
    })
    if (sessionListRef.value) {
      sessionListResizeObserver.observe(sessionListRef.value)
    }
  }

  scheduleSessionListFillCheck()
  void refreshRemoteControlStatus()
  remoteControlStatusTimer = setInterval(() => {
    void refreshRemoteControlStatus()
  }, 2_000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowShortcutKeydown)
  window.removeEventListener('keyup', handleWindowShortcutKeyup)
  window.removeEventListener('blur', handleWindowShortcutBlur)
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)

  if (remoteControlStatusTimer) {
    clearInterval(remoteControlStatusTimer)
    remoteControlStatusTimer = null
  }

  if (sessionListScrollFrame !== null) {
    window.cancelAnimationFrame(sessionListScrollFrame)
    sessionListScrollFrame = null
  }

  if (sessionListFillFrame !== null) {
    window.cancelAnimationFrame(sessionListFillFrame)
    sessionListFillFrame = null
  }

  if (sessionListResizeObserver) {
    sessionListResizeObserver.disconnect()
    sessionListResizeObserver = null
  }

  pinFlightSessionId.value = null
  pinDockedSessionId.value = null
  isProjectGroupDragging.value = false
  projectGroupDragScrollTop.value = null
  clearPinFeedback()
  hideShortcutBadges()
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
  margin-left: var(--pin-text-shift) !important;
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

/* 形态变化交给 line-md 的线条流动动画；这里再叠加一个缩放"弹出"增强存在感 */
.theme-icon-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.theme-icon-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
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
  .window-sidebar-session-column {
    transition: none;
  }

  .theme-icon-enter-active,
  .theme-icon-leave-active {
    transition: none;
  }
}
</style>
