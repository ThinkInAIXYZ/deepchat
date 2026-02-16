<template>
  <TooltipProvider :delay-duration="200">
    <div class="flex flex-row h-full w-[288px] shrink-0 window-drag-region">
      <!-- Left Column: Agent Icons (48px) -->
      <div
        class="flex flex-col items-center w-12 shrink-0 pb-2 gap-1"
        :class="isMacOS ? 'pt-9' : 'pt-2'"
      >
        <!-- All agents button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                selectedAgentId === null
                  ? 'bg-card/50 border-white/70 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="selectedAgentId = null"
            >
              <Icon icon="lucide:layers" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">All Agents</TooltipContent>
        </Tooltip>

        <div class="w-5 h-px bg-border my-1"></div>

        <!-- Agent icons -->
        <Tooltip v-for="agent in mockAgents" :key="agent.id">
          <TooltipTrigger as-child>
            <Button
              class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
              :class="
                selectedAgentId === agent.id
                  ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="selectedAgentId = selectedAgentId === agent.id ? null : agent.id"
            >
              <Icon :icon="agent.icon" class="w-4 h-4 text-foreground/80" />
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
      <div class="flex flex-col w-0 flex-1 min-w-0">
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
                    groupByProject
                      ? 'text-foreground bg-accent/80'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  "
                  @click="groupByProject = !groupByProject"
                >
                  <Icon icon="lucide:folder-kanban" class="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{
                groupByProject ? 'Group by date' : 'Group by project'
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
              <TooltipContent>New Chat</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <!-- Session list -->
        <div class="flex-1 overflow-y-auto px-1.5">
          <template v-for="group in filteredSessions" :key="group.dt">
            <div class="px-1.5 pt-3 pb-1">
              <span class="text-xs font-medium text-muted-foreground">{{ group.dt }}</span>
            </div>
            <button
              v-for="session in group.sessions"
              :key="session.id"
              class="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-all duration-150"
              :class="
                selectedSessionId === session.id
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
import { useI18n } from 'vue-i18n'

const windowPresenter = usePresenter('windowPresenter')
const devicePresenter = usePresenter('devicePresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const { t } = useI18n()

const isMacOS = ref(false)

onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
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

const mockAgents = [
  { id: 'claude', name: 'Claude', icon: 'simple-icons:anthropic' },
  { id: 'gpt4', name: 'GPT-4', icon: 'simple-icons:openai' },
  { id: 'gemini', name: 'Gemini', icon: 'simple-icons:google' },
  { id: 'local', name: 'Local Model', icon: 'lucide:cpu' }
]

const allSessions = [
  {
    id: '1',
    title: 'Fix login bug',
    agentId: 'claude',
    status: 'completed',
    projectDir: '~/Code/deepchat'
  },
  {
    id: '2',
    title: 'Refactor auth module',
    agentId: 'claude',
    status: 'working',
    projectDir: '~/Code/deepchat'
  },
  {
    id: '3',
    title: 'Write unit tests',
    agentId: 'gpt4',
    status: 'none',
    projectDir: '~/Code/api-server'
  },
  {
    id: '4',
    title: 'Add dark mode support',
    agentId: 'claude',
    status: 'none',
    projectDir: '~/Code/deepchat'
  },
  {
    id: '5',
    title: 'API integration',
    agentId: 'gemini',
    status: 'error',
    projectDir: '~/Code/api-server'
  },
  {
    id: '6',
    title: 'Database migration',
    agentId: 'gpt4',
    status: 'completed',
    projectDir: '~/Code/api-server'
  },
  {
    id: '7',
    title: 'Setup CI/CD pipeline',
    agentId: 'local',
    status: 'none',
    projectDir: '~/Code/infra'
  },
  {
    id: '8',
    title: 'Performance optimization',
    agentId: 'claude',
    status: 'none',
    projectDir: '~/Code/deepchat'
  }
]

const mockSessionsByDate = [
  { dt: 'Today', sessions: allSessions.filter((s) => ['1', '2', '3'].includes(s.id)) },
  { dt: 'Yesterday', sessions: allSessions.filter((s) => ['4', '5', '6'].includes(s.id)) },
  { dt: 'Last Week', sessions: allSessions.filter((s) => ['7', '8'].includes(s.id)) }
]

const { mockSessionId: selectedSessionId, selectSession } = useMockViewState()

const selectedAgentId = ref<string | null>(null)
const groupByProject = ref(false)

const selectedAgentName = computed(() => {
  if (selectedAgentId.value === null) return 'All Agents'
  return mockAgents.find((a) => a.id === selectedAgentId.value)?.name ?? 'All Agents'
})

const mockSessionsByProject = computed(() => {
  const projectMap = new Map<string, typeof allSessions>()
  for (const session of allSessions) {
    const dir = session.projectDir
    if (!projectMap.has(dir)) projectMap.set(dir, [])
    projectMap.get(dir)!.push(session)
  }
  return Array.from(projectMap.entries()).map(([dir, sessions]) => ({
    dt: dir.split('/').pop() ?? dir,
    sessions
  }))
})

const filteredSessions = computed(() => {
  const source = groupByProject.value ? mockSessionsByProject.value : mockSessionsByDate
  if (selectedAgentId.value === null) return source
  return source
    .map((group) => ({
      dt: group.dt,
      sessions: group.sessions.filter((s) => s.agentId === selectedAgentId.value)
    }))
    .filter((group) => group.sessions.length > 0)
})

const handleNewChat = () => {
  selectSession(null)
}

const handleSessionClick = (session: { id: string; title: string; projectDir: string }) => {
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
