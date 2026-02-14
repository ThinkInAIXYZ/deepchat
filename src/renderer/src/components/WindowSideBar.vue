<template>
  <TooltipProvider :delay-duration="200">
    <div class="flex flex-row h-full w-[288px] shrink-0">
      <!-- Left Column: Agent Icons (48px) -->
      <div class="flex flex-col items-center w-12 shrink-0 py-2 gap-1">
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
        <div class="flex items-center justify-between px-3 h-10 shrink-0">
          <span class="text-sm font-medium text-foreground truncate">
            {{ selectedAgentName }}
          </span>
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
              @click="selectedSessionId = session.id"
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
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Button } from '@shadcn/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { useI18n } from 'vue-i18n'

const windowPresenter = usePresenter('windowPresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const { t } = useI18n()

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

const mockSessions = [
  {
    dt: 'Today',
    sessions: [
      { id: '1', title: 'Fix login bug', agentId: 'claude', status: 'completed' },
      { id: '2', title: 'Refactor auth module', agentId: 'claude', status: 'working' },
      { id: '3', title: 'Write unit tests', agentId: 'gpt4', status: 'none' }
    ]
  },
  {
    dt: 'Yesterday',
    sessions: [
      { id: '4', title: 'Add dark mode support', agentId: 'claude', status: 'none' },
      { id: '5', title: 'API integration', agentId: 'gemini', status: 'error' },
      { id: '6', title: 'Database migration', agentId: 'gpt4', status: 'completed' }
    ]
  },
  {
    dt: 'Last Week',
    sessions: [
      { id: '7', title: 'Setup CI/CD pipeline', agentId: 'local', status: 'none' },
      { id: '8', title: 'Performance optimization', agentId: 'claude', status: 'none' }
    ]
  }
]

const selectedAgentId = ref<string | null>(null)
const selectedSessionId = ref<string | null>('2')

const selectedAgentName = computed(() => {
  if (selectedAgentId.value === null) return 'All Agents'
  return mockAgents.find((a) => a.id === selectedAgentId.value)?.name ?? 'All Agents'
})

const filteredSessions = computed(() => {
  if (selectedAgentId.value === null) return mockSessions
  return mockSessions
    .map((group) => ({
      dt: group.dt,
      sessions: group.sessions.filter((s) => s.agentId === selectedAgentId.value)
    }))
    .filter((group) => group.sessions.length > 0)
})

const handleNewChat = () => {
  // Mock: just deselect current session
  selectedSessionId.value = null
}
</script>
