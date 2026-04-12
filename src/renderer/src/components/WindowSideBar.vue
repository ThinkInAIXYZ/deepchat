<template>
  <TooltipProvider :delay-duration="200">
    <div
      data-testid="window-sidebar"
      class="flex flex-row h-full shrink-0 window-drag-region transition-all duration-200"
      :class="collapsed ? 'w-12' : 'w-[288px]'"
    >
      <!-- Left Column: Agent Icons (48px) -->
      <div class="flex flex-col items-center shrink-0 pt-2 pb-2 gap-1 w-12">
        <!-- All agents button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                agentStore.selectedAgentId === null
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
              size="icon"
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                agentStore.selectedAgentId === agent.id
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
      <div v-show="!collapsed" class="flex flex-col w-0 flex-1 min-w-0">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 h-10 shrink-0">
          <span class="text-sm font-medium text-foreground truncate">
            {{ selectedAgentName }}
          </span>
          <div class="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150"
                  :class="
                    sessionStore.groupMode === 'project'
                      ? 'text-foreground bg-accent/80'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  "
                  @click="sessionStore.toggleGroupMode()"
                >
                  <Icon icon="lucide:folder-kanban" class="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{
                sessionStore.groupMode === 'project'
                  ? t('chat.sidebar.groupByDate')
                  : t('chat.sidebar.groupByProject')
              }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all duration-150"
                  @click="handleNewChat"
                >
                  <Icon icon="lucide:plus" class="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ t('common.newChat') }}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div v-if="!collapsed" class="px-3 pb-2">
          <div class="relative">
            <Icon
              icon="lucide:search"
              class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70"
            />
            <Input
              v-model="sessionSearchQuery"
              class="h-8 rounded-xl border-0 bg-muted/60 pl-8 pr-8 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              :placeholder="t('chat.sidebar.searchPlaceholder')"
              :aria-label="t('chat.sidebar.searchAriaLabel')"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              v-if="sessionSearchQuery"
              type="button"
              class="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              :title="t('common.close')"
              :aria-label="t('common.close')"
              @click="sessionSearchQuery = ''"
            >
              <Icon icon="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-if="pinnedSessions.length === 0 && filteredGroups.length === 0"
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
        <div ref="sessionListRef" class="session-list flex-1 overflow-y-auto px-1.5">
          <div v-if="pinnedSessions.length > 0" class="pt-2">
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground"
              data-group-id="__pinned__"
              :aria-expanded="!isPinnedSectionCollapsed"
              @click="togglePinnedSection"
            >
              <Icon
                :icon="isPinnedSectionCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'"
                class="h-3 w-3 shrink-0"
              />
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

            <Transition name="sidebar-group-collapse">
              <div v-if="!isPinnedSectionCollapsed" class="space-y-0.5 pl-4">
                <WindowSideBarSessionItem
                  v-for="session in pinnedSessions"
                  :key="`pinned-${session.id}`"
                  :session="session"
                  :active="sessionStore.activeSessionId === session.id"
                  region="pinned"
                  :hero-hidden="pinFlightSessionId === session.id"
                  :pin-feedback-mode="pinFeedbackSessionId === session.id ? pinFeedbackMode : null"
                  :search-query="sessionSearchQuery"
                  @select="handleSessionClick"
                  @toggle-pin="handleTogglePin"
                  @delete="openDeleteDialog"
                />
              </div>
            </Transition>
          </div>

          <template v-for="group in filteredGroups" :key="getGroupIdentifier(group)">
            <button
              type="button"
              class="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/40 hover:text-foreground"
              :data-group-id="getGroupIdentifier(group)"
              :aria-expanded="!isGroupCollapsed(group)"
              @click="toggleGroup(group)"
            >
              <Icon
                :icon="isGroupCollapsed(group) ? 'lucide:chevron-right' : 'lucide:chevron-down'"
                class="h-3 w-3 shrink-0"
              />
              <span class="shrink-0 size-6 flex items-center justify-center">
                <Icon
                  :icon="isPinnedSectionCollapsed ? 'lucide:folder-closed' : 'lucide:folder-open'"
                  class="size-4"
                />
              </span>
              <span class="truncate">
                {{ getGroupLabel(group) }}
              </span>
            </button>
            <Transition name="sidebar-group-collapse">
              <div v-if="!isGroupCollapsed(group)" class="space-y-0.5 pl-4">
                <WindowSideBarSessionItem
                  v-for="session in group.sessions"
                  :key="session.id"
                  :session="session"
                  :active="sessionStore.activeSessionId === session.id"
                  region="grouped"
                  :hero-hidden="pinFlightSessionId === session.id"
                  :pin-feedback-mode="pinFeedbackSessionId === session.id ? pinFeedbackMode : null"
                  :search-query="sessionSearchQuery"
                  @select="handleSessionClick"
                  @toggle-pin="handleTogglePin"
                  @delete="openDeleteDialog"
                />
              </div>
            </Transition>
          </template>
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
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { usePresenter, useRemoteControlPresenter } from '@/composables/usePresenter'
import { SETTINGS_EVENTS } from '@/events'
import { useAgentStore } from '@/stores/ui/agent'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore, type SessionGroup, type UISession } from '@/stores/ui/session'
import { useSpotlightStore } from '@/stores/ui/spotlight'
import type {
  QQBotRemoteStatus,
  RemoteChannel,
  RemoteChannelDescriptor,
  TelegramRemoteStatus,
  FeishuRemoteStatus,
  RemoteRuntimeState
} from '@shared/presenter'
import AgentAvatar from './icons/AgentAvatar.vue'
import WindowSideBarSessionItem from './WindowSideBarSessionItem.vue'
import { useI18n } from 'vue-i18n'
import { useSidebarStore } from '@/stores/ui/sidebar'

type PinFeedbackMode = 'pinning' | 'unpinning'

const PIN_FEEDBACK_DURATION_MS = 560
const PIN_FLIGHT_DURATION_MS = 500

const windowPresenter = usePresenter('windowPresenter')
const remoteControlPresenter = useRemoteControlPresenter()
const { t } = useI18n()
const agentStore = useAgentStore()
const pageRouterStore = usePageRouterStore()
const sessionStore = useSessionStore()
const sidebarStore = useSidebarStore()
const spotlightStore = useSpotlightStore()

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
  }
]

const collapsed = computed(() => sidebarStore.collapsed)
const sessionSearchQuery = ref('')
const remoteChannelDescriptors = ref<RemoteChannelDescriptor[]>(fallbackRemoteChannels)
const remoteControlStatus = ref<{
  telegram: TelegramRemoteStatus | null
  feishu: FeishuRemoteStatus | null
  qqbot: QQBotRemoteStatus | null
}>({
  telegram: null,
  feishu: null,
  qqbot: null
})
let agentSwitchSeq = 0
let agentSwitchQueue: Promise<void> = Promise.resolve()
let remoteControlStatusTimer: ReturnType<typeof setInterval> | null = null
let pinFeedbackTimer: number | null = null
const selectedAgentName = computed(
  () => agentStore.selectedAgent?.name ?? t('chat.sidebar.allAgents')
)

const presenterCompat = remoteControlPresenter as typeof remoteControlPresenter & {
  listRemoteChannels?: () => Promise<RemoteChannelDescriptor[]>
  getChannelStatus?: (
    channel: RemoteChannel
  ) => Promise<TelegramRemoteStatus | FeishuRemoteStatus | QQBotRemoteStatus>
}
const implementedRemoteChannels = computed(() =>
  remoteChannelDescriptors.value
    .filter((descriptor) => descriptor.implemented)
    .map((descriptor) => descriptor.id)
    .filter((channel): channel is RemoteChannel => channel !== 'weixin-ilink')
)
const showRemoteControlButton = computed(() =>
  implementedRemoteChannels.value.some((channel) =>
    channel === 'telegram'
      ? remoteControlStatus.value.telegram?.enabled
      : channel === 'feishu'
        ? remoteControlStatus.value.feishu?.enabled
        : remoteControlStatus.value.qqbot?.enabled
  )
)
const aggregatedRemoteControlState = computed<RemoteRuntimeState>(() => {
  const states = implementedRemoteChannels.value
    .map((channel) =>
      channel === 'telegram'
        ? remoteControlStatus.value.telegram
        : channel === 'feishu'
          ? remoteControlStatus.value.feishu
          : remoteControlStatus.value.qqbot
    )
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
      const status =
        channel === 'telegram'
          ? remoteControlStatus.value.telegram
          : channel === 'feishu'
            ? remoteControlStatus.value.feishu
            : remoteControlStatus.value.qqbot
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
const pinnedSessions = computed(() =>
  sessionStore.getPinnedSessions(agentStore.selectedAgentId).filter(matchesSessionSearch)
)
const filteredGroups = computed(() =>
  sessionStore
    .getFilteredGroups(agentStore.selectedAgentId)
    .map((group) => ({
      label: group.label,
      labelKey: group.labelKey,
      sessions: group.sessions.filter(matchesSessionSearch)
    }))
    .filter((group) => group.sessions.length > 0)
)
const pinFlightSessionId = ref<string | null>(null)
const pinFeedbackSessionId = ref<string | null>(null)
const pinFeedbackMode = ref<PinFeedbackMode | null>(null)
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

const getGroupIdentifier = (group: SessionGroup) => group.labelKey ?? group.label

const getGroupLabel = (group: SessionGroup) => (group.labelKey ? t(group.labelKey) : group.label)

const isGroupCollapsed = (group: SessionGroup) =>
  collapsedGroupIds.value.has(getGroupIdentifier(group))

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
  [filteredGroups, () => sessionStore.activeSessionId],
  ([groups, activeSessionId]) => {
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
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    void windowPresenter.openOrFocusSettingsWindow()
  }
}

const navigateToSettings = (windowId: number, routeName: 'settings-remote') => {
  void windowPresenter.sendToWindow(windowId, SETTINGS_EVENTS.NAVIGATE, {
    routeName
  })
}

const openRemoteSettings = async () => {
  const settingsWindowId = await windowPresenter.createSettingsWindow()
  if (settingsWindowId == null) {
    return
  }

  navigateToSettings(settingsWindowId, 'settings-remote')
  window.setTimeout(() => {
    navigateToSettings(settingsWindowId, 'settings-remote')
  }, 250)
}

const refreshRemoteControlStatus = async () => {
  try {
    remoteChannelDescriptors.value = presenterCompat.listRemoteChannels
      ? await presenterCompat.listRemoteChannels()
      : fallbackRemoteChannels
    const [telegram, feishu, qqbot] = presenterCompat.getChannelStatus
      ? await Promise.all([
          presenterCompat.getChannelStatus('telegram'),
          presenterCompat.getChannelStatus('feishu'),
          presenterCompat.getChannelStatus('qqbot')
        ])
      : [
          await remoteControlPresenter.getTelegramStatus(),
          {
            channel: 'feishu',
            enabled: false,
            state: 'disabled',
            bindingCount: 0,
            pairedUserCount: 0,
            lastError: null,
            botUser: null
          } satisfies FeishuRemoteStatus,
          {
            channel: 'qqbot',
            enabled: false,
            state: 'disabled',
            bindingCount: 0,
            pairedUserCount: 0,
            lastError: null,
            botUser: null
          } satisfies QQBotRemoteStatus
        ]
    remoteControlStatus.value = {
      telegram,
      feishu,
      qqbot
    }
  } catch (error) {
    console.warn('[WindowSideBar] Failed to refresh remote control status:', error)
  }
}

const handleNewChat = () => {
  if (sessionStore.hasActiveSession) {
    void sessionStore.closeSession()
    return
  }

  pageRouterStore.goToNewThread({ refresh: true })
}

const handleAgentSelect = async (id: string | null) => {
  const requestSeq = ++agentSwitchSeq

  agentSwitchQueue = agentSwitchQueue
    .then(async () => {
      const currentAgentId = agentStore.selectedAgentId
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

const handleSessionClick = (session: { id: string }) => {
  void sessionStore.selectSession(session.id)
}

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
  pinFeedbackMode.value = nextPinned ? 'pinning' : 'unpinning'
  pinFeedbackTimer = window.setTimeout(() => {
    pinFeedbackSessionId.value = null
    pinFeedbackMode.value = null
    pinFeedbackTimer = null
  }, PIN_FEEDBACK_DURATION_MS)
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

const getSessionItemElement = (sessionId: string, region: 'pinned' | 'grouped') =>
  document.querySelector<HTMLElement>(
    `.session-item[data-session-id="${sessionId}"][data-session-region="${region}"]`
  )

const createPinFlightClone = (sourceElement: HTMLElement, sourceRect: DOMRect) => {
  const clone = sourceElement.cloneNode(true) as HTMLElement

  clone.removeAttribute('style')
  delete clone.dataset.pinFx
  clone.dataset.heroHidden = 'false'
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
  const sourceRegion = session.isPinned ? 'pinned' : 'grouped'
  const targetRegion = nextPinned ? 'pinned' : 'grouped'
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
  await nextTick()

  try {
    await commitPinToggle(session, nextPinned, false)
    restoreSessionListScroll(preservedScrollTop)
    await waitForAnimationFrame()
    restoreSessionListScroll(preservedScrollTop)
    await waitForAnimationFrame()

    const targetElement = getSessionItemElement(session.id, targetRegion)
    const targetRect = targetElement?.getBoundingClientRect()

    if (!targetElement || !targetRect || targetRect.width === 0 || targetRect.height === 0) {
      pinFlightSessionId.value = null
      applyPinFeedback(session.id, nextPinned)
      return
    }

    const deltaX = targetRect.left - sourceRect.left
    const deltaY = targetRect.top - sourceRect.top
    const scaleX = targetRect.width / sourceRect.width
    const scaleY = targetRect.height / sourceRect.height

    const animation = clone.animate(
      [
        {
          transform: 'translate3d(0, 0, 0) scale(1)',
          opacity: 1,
          offset: 0
        },
        {
          transform: `translate3d(${deltaX * 0.88}px, ${deltaY * 0.88}px, 0) scale(${1.015}, ${1.015})`,
          opacity: 1,
          offset: 0.72
        },
        {
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
          opacity: 1,
          offset: 1
        }
      ],
      {
        duration: PIN_FLIGHT_DURATION_MS,
        easing: 'cubic-bezier(0.22, 0.88, 0.24, 1)',
        fill: 'forwards'
      }
    )

    await animation.finished.catch(() => undefined)
    pinFlightSessionId.value = null
    await nextTick()
    applyPinFeedback(session.id, nextPinned)
  } finally {
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
  void refreshRemoteControlStatus()
  remoteControlStatusTimer = setInterval(() => {
    void refreshRemoteControlStatus()
  }, 2_000)
})

onUnmounted(() => {
  if (remoteControlStatusTimer) {
    clearInterval(remoteControlStatusTimer)
    remoteControlStatusTimer = null
  }

  pinFlightSessionId.value = null
  clearPinFeedback()
})
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.session-list {
  overflow-anchor: none;
}

button {
  -webkit-app-region: no-drag;
}

:global(.sidebar-pin-flight) {
  transform: translateZ(0);
  backface-visibility: hidden;
}

.sidebar-group-collapse-enter-active,
.sidebar-group-collapse-leave-active {
  overflow: hidden;
  transition:
    max-height 180ms ease,
    opacity 160ms ease,
    transform 180ms ease;
}

.sidebar-group-collapse-enter-from,
.sidebar-group-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.sidebar-group-collapse-enter-to,
.sidebar-group-collapse-leave-from {
  max-height: 720px;
  opacity: 1;
  transform: translateY(0);
}
</style>
