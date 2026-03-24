<template>
  <TooltipProvider :delay-duration="200">
    <div
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
          <TooltipContent side="right">{{ remoteControlTooltip }}</TooltipContent>
        </Tooltip>

        <!-- Collapse toggle -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none"
              @click="collapsed = !collapsed"
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

        <!-- Session list -->
        <div class="flex-1 overflow-y-auto px-1.5">
          <div v-if="pinnedSessions.length > 0" class="pt-2 space-y-0.5">
            <WindowSideBarSessionItem
              v-for="session in pinnedSessions"
              :key="`pinned-${session.id}`"
              :session="session"
              :active="sessionStore.activeSessionId === session.id"
              @select="handleSessionClick"
              @toggle-pin="handleTogglePin"
              @rename="openRenameDialog"
              @clear="openClearDialog"
              @delete="openDeleteDialog"
            />
          </div>

          <!-- Empty state -->
          <div
            v-if="pinnedSessions.length === 0 && filteredGroups.length === 0"
            class="flex flex-col items-center justify-center h-full px-4 text-center"
          >
            <Icon icon="lucide:message-square-plus" class="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p class="text-sm text-muted-foreground/60">{{ t('chat.sidebar.emptyTitle') }}</p>
            <p class="text-xs text-muted-foreground/40 mt-1">
              {{ t('chat.sidebar.emptyDescription') }}
            </p>
          </div>

          <template v-for="group in filteredGroups" :key="group.label">
            <div class="px-1.5 pt-3 pb-1">
              <span class="text-xs font-medium text-muted-foreground">{{
                group.labelKey ? t(group.labelKey) : group.label
              }}</span>
            </div>
            <WindowSideBarSessionItem
              v-for="session in group.sessions"
              :key="session.id"
              :session="session"
              :active="sessionStore.activeSessionId === session.id"
              @select="handleSessionClick"
              @toggle-pin="handleTogglePin"
              @rename="openRenameDialog"
              @clear="openClearDialog"
              @delete="openDeleteDialog"
            />
          </template>
        </div>
      </div>
    </div>
  </TooltipProvider>

  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.rename.title') }}</DialogTitle>
        <DialogDescription>{{ t('dialog.rename.description') }}</DialogDescription>
      </DialogHeader>
      <Input v-model="renameValue" />
      <DialogFooter>
        <Button variant="outline" @click="renameDialogOpen = false">{{
          t('dialog.cancel')
        }}</Button>
        <Button variant="default" @click="handleRenameConfirm">{{ t('dialog.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="clearDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.cleanMessages.title') }}</DialogTitle>
        <DialogDescription>{{ t('dialog.cleanMessages.description') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="clearDialogOpen = false">{{ t('dialog.cancel') }}</Button>
        <Button variant="destructive" @click="handleClearConfirm">{{
          t('dialog.cleanMessages.confirm')
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue'
import { Input } from '@shadcn/components/ui/input'
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
import { usePresenter } from '@/composables/usePresenter'
import { SETTINGS_EVENTS } from '@/events'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore, type UISession } from '@/stores/ui/session'
import type { TelegramRemoteStatus } from '@shared/presenter'
import AgentAvatar from './icons/AgentAvatar.vue'
import WindowSideBarSessionItem from './WindowSideBarSessionItem.vue'
import { useI18n } from 'vue-i18n'

const windowPresenter = usePresenter('windowPresenter')
const remoteControlPresenter = usePresenter('remoteControlPresenter')
const { t } = useI18n()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()

const collapsed = ref(false)
const remoteControlStatus = ref<TelegramRemoteStatus | null>(null)
let agentSwitchSeq = 0
let agentSwitchQueue: Promise<void> = Promise.resolve()
let remoteControlStatusTimer: ReturnType<typeof setInterval> | null = null
const selectedAgentName = computed(
  () => agentStore.selectedAgent?.name ?? t('chat.sidebar.allAgents')
)
const showRemoteControlButton = computed(() => remoteControlStatus.value?.enabled === true)
const remoteControlTooltip = computed(() => {
  const state = remoteControlStatus.value?.state ?? 'starting'
  return t(`chat.sidebar.remoteControlStatus.${state}`)
})
const remoteControlButtonClass = computed(() => {
  const state = remoteControlStatus.value?.state ?? 'starting'

  if (state === 'error') {
    return 'border-red-500/40 bg-red-500/10 hover:bg-red-500/15'
  }

  return 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15'
})
const remoteControlIconClass = computed(() => {
  const state = remoteControlStatus.value?.state ?? 'starting'

  if (state === 'error') {
    return 'text-red-600 dark:text-red-400'
  }

  return ['text-emerald-600 dark:text-emerald-400', state === 'starting' ? 'animate-pulse' : '']
})

const pinnedSessions = computed(() => sessionStore.getPinnedSessions(agentStore.selectedAgentId))
const filteredGroups = computed(() => sessionStore.getFilteredGroups(agentStore.selectedAgentId))
const renameTargetSession = ref<UISession | null>(null)
const clearTargetSession = ref<UISession | null>(null)
const deleteTargetSession = ref<UISession | null>(null)
const renameValue = ref('')

const renameDialogOpen = computed({
  get: () => renameTargetSession.value !== null,
  set: (open: boolean) => {
    if (!open) {
      renameTargetSession.value = null
    }
  }
})

const clearDialogOpen = computed({
  get: () => clearTargetSession.value !== null,
  set: (open: boolean) => {
    if (!open) {
      clearTargetSession.value = null
    }
  }
})

const deleteDialogOpen = computed({
  get: () => deleteTargetSession.value !== null,
  set: (open: boolean) => {
    if (!open) {
      deleteTargetSession.value = null
    }
  }
})

const openSettings = () => {
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    void windowPresenter.openOrFocusSettingsWindow()
  }
}

const navigateToSettings = (windowId: number, routeName: 'settings-remote') => {
  windowPresenter.sendToWindow(windowId, SETTINGS_EVENTS.NAVIGATE, {
    routeName
  })
}

const openRemoteSettings = async () => {
  await windowPresenter.createSettingsWindow()
  const settingsWindowId = windowPresenter.getSettingsWindowId()
  if (settingsWindowId == null) {
    return
  }

  navigateToSettings(settingsWindowId, 'settings-remote')
  window.setTimeout(() => {
    if (windowPresenter.getSettingsWindowId() === settingsWindowId) {
      navigateToSettings(settingsWindowId, 'settings-remote')
    }
  }, 250)
}

const refreshRemoteControlStatus = async () => {
  try {
    remoteControlStatus.value = await remoteControlPresenter.getTelegramStatus()
  } catch (error) {
    console.warn('[WindowSideBar] Failed to refresh remote control status:', error)
  }
}

const handleNewChat = () => {
  void sessionStore.closeSession()
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

const closeAllSessionDialogs = () => {
  renameTargetSession.value = null
  clearTargetSession.value = null
  deleteTargetSession.value = null
}

const openRenameDialog = (session: UISession) => {
  closeAllSessionDialogs()
  renameValue.value = session.title
  renameTargetSession.value = session
}

const openClearDialog = (session: UISession) => {
  closeAllSessionDialogs()
  clearTargetSession.value = session
}

const openDeleteDialog = (session: UISession) => {
  closeAllSessionDialogs()
  deleteTargetSession.value = session
}

const handleTogglePin = async (session: UISession) => {
  try {
    await sessionStore.toggleSessionPinned(session.id, !session.isPinned)
  } catch (error) {
    console.error('Failed to toggle pin status:', error)
  }
}

const handleRenameConfirm = async () => {
  const targetSession = renameTargetSession.value
  if (!targetSession) {
    return
  }

  try {
    await sessionStore.renameSession(targetSession.id, renameValue.value)
  } catch (error) {
    console.error(t('common.error.renameChatFailed'), error)
  }

  renameTargetSession.value = null
}

const handleClearConfirm = async () => {
  const targetSession = clearTargetSession.value
  if (!targetSession) {
    return
  }

  try {
    await sessionStore.clearSessionMessages(targetSession.id)
  } catch (error) {
    console.error(t('common.error.cleanMessagesFailed'), error)
  }

  clearTargetSession.value = null
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
})
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
