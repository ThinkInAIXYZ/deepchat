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
                selectedTabId === 'all'
                  ? 'bg-card/50 border-white/70 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                  : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
              "
              @click="selectedTabId = 'all'"
            >
              <Icon icon="lucide:layers" class="w-4 h-4 text-foreground/80" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('sidebar.allAgents') }}</TooltipContent>
        </Tooltip>

        <div class="w-5 h-px bg-border my-1"></div>

        <!-- ACP Agent icons -->
        <template v-if="acpAgentTabs.length > 0">
          <Tooltip v-for="agent in acpAgentTabs" :key="agent.id">
            <TooltipTrigger as-child>
              <Button
                class="flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150"
                :class="
                  selectedTabId === agent.id
                    ? 'bg-card/50 border-white/80 dark:border-white/20 ring-1 ring-black/10 hover:bg-white/30 dark:hover:bg-white/10'
                    : 'bg-transparent border-none hover:bg-white/30 dark:hover:bg-white/10 shadow-none'
                "
                @click="selectedTabId = agent.id"
              >
                <Icon :icon="agent.icon" class="w-4 h-4 text-foreground/80" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{{ agent.name }}</TooltipContent>
          </Tooltip>
        </template>

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
            {{ selectedTabName }}
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
            <TooltipContent>{{ t('sidebar.newChat') }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Session list -->
        <div class="flex-1 overflow-y-auto px-1.5">
          <template v-if="filteredThreadGroups.length === 0">
            <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Icon icon="lucide:message-square" class="w-10 h-10 text-muted-foreground/50 mb-3" />
              <p class="text-sm text-muted-foreground mb-3">
                {{ emptyStateMessage }}
              </p>
              <Button variant="outline" size="sm" @click="handleNewChat">
                <Icon icon="lucide:plus" class="w-4 h-4 mr-1.5" />
                {{ t('sidebar.startChat') }}
              </Button>
            </div>
          </template>
          <template v-else>
            <template v-for="group in filteredThreadGroups" :key="group.dt">
              <div class="px-1.5 pt-3 pb-1">
                <span class="text-xs font-medium text-muted-foreground">{{ group.dt }}</span>
              </div>
              <button
                v-for="thread in group.dtThreads"
                :key="thread.id"
                class="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-all duration-150"
                :class="
                  activeThreadId === thread.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50'
                "
                @click="handleThreadClick(thread.id)"
              >
                <span class="flex-1 text-sm truncate">{{ thread.title }}</span>
                <span v-if="getThreadStatus(thread.id) === 'working'" class="shrink-0">
                  <Icon icon="lucide:loader-2" class="w-3.5 h-3.5 text-primary animate-spin" />
                </span>
                <span v-else-if="getThreadStatus(thread.id) === 'completed'" class="shrink-0">
                  <Icon icon="lucide:check" class="w-3.5 h-3.5 text-green-500" />
                </span>
                <span v-else-if="getThreadStatus(thread.id) === 'error'" class="shrink-0">
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
import { useChatStore, type WorkingStatus } from '@/stores/chat'
import { useAgentModelStore } from '@/stores/agentModelStore'
import { CONVERSATION_EVENTS } from '@/events'
import type { CONVERSATION_SETTINGS } from '@shared/presenter'

interface SidebarTab {
  id: string
  type: 'all' | 'acp'
  name: string
  icon: string
  modelId?: string
}

const windowPresenter = usePresenter('windowPresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const { t } = useI18n()

const chatStore = useChatStore()
const agentModelStore = useAgentModelStore()

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

const getAgentIcon = (agentId: string): string => {
  const iconMap: Record<string, string> = {
    claude: 'simple-icons:anthropic',
    codex: 'simple-icons:openai',
    gemini: 'simple-icons:google',
    cursor: 'simple-icons:cursor',
    windsurf: 'simple-icons:code',
    copilot: 'simple-icons:github',
    kiro: 'lucide:bot',
    cline: 'lucide:terminal',
    aider: 'lucide:code'
  }
  const lowerAgentId = agentId.toLowerCase()
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lowerAgentId.includes(key)) {
      return icon
    }
  }
  return 'lucide:bot'
}

const acpAgentTabs = computed<SidebarTab[]>(() => {
  const acpModels = agentModelStore.agentModels['acp'] || []
  return acpModels.map((model) => ({
    id: `acp-${model.id}`,
    type: 'acp' as const,
    name: model.name,
    icon: getAgentIcon(model.id),
    modelId: model.id
  }))
})

const selectedTabId = ref<string>('all')

const activeThreadId = computed(() => chatStore.getActiveThreadId())

const selectedTabName = computed(() => {
  if (selectedTabId.value === 'all') {
    return t('sidebar.allAgents')
  }
  const tab = acpAgentTabs.value.find((t) => t.id === selectedTabId.value)
  return tab?.name ?? t('sidebar.allAgents')
})

const filteredThreadGroups = computed(() => {
  if (selectedTabId.value === 'all') {
    return chatStore.threads
  }

  const tab = acpAgentTabs.value.find((t) => t.id === selectedTabId.value)
  if (!tab || tab.type !== 'acp') {
    return chatStore.threads
  }

  return chatStore.threads
    .map((group) => ({
      dt: group.dt,
      dtThreads: group.dtThreads.filter(
        (thread) => thread.settings.providerId === 'acp' && thread.settings.modelId === tab.modelId
      )
    }))
    .filter((group) => group.dtThreads.length > 0)
})

const emptyStateMessage = computed(() => {
  if (selectedTabId.value === 'all') {
    return t('sidebar.noConversations')
  }
  const tab = acpAgentTabs.value.find((t) => t.id === selectedTabId.value)
  if (tab) {
    return t('sidebar.noConversationsWith', { name: tab.name })
  }
  return t('sidebar.noConversations')
})

const getThreadStatus = (threadId: string): WorkingStatus | null => {
  return chatStore.getThreadWorkingStatus(threadId)
}

const handleThreadClick = async (threadId: string) => {
  try {
    await chatStore.setActiveThread(threadId)
  } catch (error) {
    console.error('Failed to switch thread:', error)
  }
}

const handleNewChat = async () => {
  try {
    const settings: Partial<CONVERSATION_SETTINGS> = {}

    if (selectedTabId.value !== 'all') {
      const tab = acpAgentTabs.value.find((t) => t.id === selectedTabId.value)
      if (tab && tab.type === 'acp') {
        settings.providerId = 'acp'
        settings.modelId = tab.modelId
        settings.chatMode = 'acp agent'
      }
    }

    await chatStore.createThread(t('sidebar.newChatTitle'), settings)
  } catch (error) {
    console.error('Failed to create new chat:', error)
  }
}

const handleConversationListUpdated = () => {}

let cleanupFns: Array<() => void> = []

onMounted(async () => {
  await agentModelStore.refreshAgentModels('acp')

  const removeListener = window.electron.ipcRenderer.on(
    CONVERSATION_EVENTS.LIST_UPDATED,
    handleConversationListUpdated
  )
  cleanupFns.push(removeListener)
})

onUnmounted(() => {
  cleanupFns.forEach((fn) => fn())
  cleanupFns = []
})
</script>
