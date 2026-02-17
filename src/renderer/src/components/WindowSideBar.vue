<template>
  <TooltipProvider :delay-duration="200">
    <div
      class="flex flex-row h-full shrink-0 window-drag-region transition-all duration-200"
      :class="collapsed ? (isMacOS ? 'w-[70px]' : 'w-12') : 'w-[288px]'"
    >
      <!-- Left Column: Agent Icons (48px) -->
      <div
        class="flex flex-col items-center shrink-0 pb-2 gap-1"
        :class="[isMacOS ? 'pt-9' : 'pt-2', collapsed && isMacOS ? 'w-[70px]' : 'w-12']"
      >
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
              @click="agentStore.selectAgent(null)"
            >
              <Icon icon="lucide:layers" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('sidebar.allAgents') }}</TooltipContent>
        </Tooltip>

        <div class="w-5 h-px bg-border my-1"></div>

        <!-- Agent icons -->
        <Tooltip v-for="agent in sidebarAgents" :key="agent.id">
          <TooltipTrigger as-child>
            <Button
              size="icon"
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                agentStore.selectedAgentId === agent.id
                  ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="
                agentStore.selectAgent(agentStore.selectedAgentId === agent.id ? null : agent.id)
              "
            >
              <ModelIcon
                v-if="agent.type !== 'local'"
                :model-id="getAgentIconId(agent)"
                custom-class="w-4 h-4"
                :is-dark="themeStore.isDark"
              />
              <Icon v-else icon="lucide:laptop" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{
            agent.type === 'local' ? t('sidebar.localAgent') : agent.name
          }}</TooltipContent>
        </Tooltip>

        <!-- Spacer -->
        <div class="flex-1"></div>

        <!-- Bottom action buttons -->
        <div class="w-5 h-px bg-border my-1"></div>

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
            collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')
          }}</TooltipContent>
        </Tooltip>

        <!-- Debug: toggle welcome page -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                showMockWelcome
                  ? 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/20'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="showMockWelcome = !showMockWelcome"
            >
              <Icon icon="lucide:bug" class="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('sidebar.toggleWelcomePage') }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none"
              :title="t('common.browser.name')"
              @click="onBrowserClick"
            >
              <Icon icon="lucide:compass" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('common.browser.name') }}</TooltipContent>
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
        <div
          class="flex items-center justify-between px-3 h-10 shrink-0"
          :class="isMacOS ? 'mt-6' : ''"
        >
          <span class="text-sm font-medium text-foreground truncate">
            {{ selectedAgentName }}
          </span>
          <div class="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150"
                  :class="
                    sessionListGroupBy === 'project'
                      ? 'text-foreground bg-accent/80'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  "
                  @click="toggleGroupBy"
                >
                  <Icon icon="lucide:folder-kanban" class="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{
                sessionListGroupBy === 'project'
                  ? t('sidebar.groupByDate')
                  : t('sidebar.groupByProject')
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
              <TooltipContent>{{ t('sidebar.newChat') }}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <!-- Session list -->
        <div class="flex-1 overflow-y-auto px-1.5">
          <!-- Loading state -->
          <div v-if="sessionListLoading" class="flex items-center justify-center h-full">
            <Icon icon="lucide:loader-2" class="w-6 h-6 text-muted-foreground animate-spin" />
          </div>
          <!-- Empty state -->
          <div
            v-else-if="groupedSessions.length === 0"
            class="flex flex-col items-center justify-center h-full px-4 text-center"
          >
            <Icon icon="lucide:message-square-plus" class="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p class="text-sm text-muted-foreground/60">{{ t('sidebar.noConversations') }}</p>
            <p class="text-xs text-muted-foreground/40 mt-1">{{ t('sidebar.startNewChat') }}</p>
          </div>

          <template v-else>
            <template v-for="group in groupedSessions" :key="group.dt">
              <div class="px-1.5 pt-3 pb-1">
                <span class="text-xs font-medium text-muted-foreground">{{ group.dt }}</span>
              </div>
              <button
                v-for="session in group.sessions"
                :key="session.id"
                class="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-all duration-150"
                :class="
                  mockSessionId === session.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50'
                "
                @click="handleSessionClick(session)"
              >
                <span class="flex-1 text-sm truncate">{{ session.title }}</span>
                <span v-if="session.status === 'working'" class="shrink-0">
                  <Icon icon="lucide:loader-2" class="w-3.5 h-3.5 text-primary animate-spin" />
                </span>
                <span v-else-if="session.status === 'completed'" class="shrink-0">
                  <Icon icon="lucide:check" class="w-3.5 h-3.5 text-green-500" />
                </span>
                <span v-else-if="session.status === 'error'" class="shrink-0">
                  <Icon icon="lucide:alert-circle" class="w-3.5 h-3.5 text-destructive" />
                </span>
              </button>
            </template>
          </template>
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Button } from '@shadcn/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { useMockViewState } from '@/composables/useMockViewState'
import { useThemeStore } from '@/stores/theme'
import { useAgentStore, LOCAL_AGENT_ID } from '@/stores/agent'
import { useSessionList } from '@/composables/useSessionList'
import ModelIcon from './icons/ModelIcon.vue'
import { useI18n } from 'vue-i18n'
import type { AcpAgent } from '@shared/types/presenters/agentConfig.presenter'
import type { SessionListItem } from '@/composables/useSessionList'

const windowPresenter = usePresenter('windowPresenter')
const devicePresenter = usePresenter('devicePresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const { t } = useI18n()
const themeStore = useThemeStore()
const agentStore = useAgentStore()

const isMacOS = ref(false)

onMounted(async () => {
  const deviceInfo = await devicePresenter.getDeviceInfo()
  isMacOS.value = deviceInfo.platform === 'darwin'
  await agentStore.loadAgents()
  await sessionListLoadSessions()
})

const openSettings = () => {
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    windowPresenter.openOrFocusSettingsTab(windowId)
  }
}

const onBrowserClick = async () => {
  try {
    await yoBrowserPresenter.show(true)
  } catch (error) {
    console.warn('Failed to open browser window.', error)
  }
}

const sidebarAgents = computed(() => agentStore.sidebarAgents)

function getAgentIconId(agent: AcpAgent): string {
  return agent.builtinId || agent.id
}

const {
  groupedSessions,
  groupBy: sessionListGroupBy,
  loading: sessionListLoading,
  loadSessions: sessionListLoadSessions,
  setGroupBy: sessionListSetGroupBy
} = useSessionList(
  computed(() => agentStore.selectedAgentId),
  computed(() => agentStore.templateAgents.map((a) => a.id))
)

const { mockSessionId, showMockWelcome, selectSession } = useMockViewState()

const collapsed = ref(false)

const selectedAgentName = computed(() => {
  if (agentStore.selectedAgentId === null) return t('sidebar.allAgents')
  if (agentStore.selectedAgentId === LOCAL_AGENT_ID) return t('sidebar.localAgent')
  const agent = agentStore.allAgents.find((a) => a.id === agentStore.selectedAgentId)
  return agent?.name ?? t('sidebar.allAgents')
})

function toggleGroupBy() {
  sessionListSetGroupBy(sessionListGroupBy.value === 'project' ? 'time' : 'project')
}

const handleNewChat = () => {
  selectSession(null)
}

const handleSessionClick = (session: SessionListItem) => {
  selectSession(session.id, session.title, session.projectDir)
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
