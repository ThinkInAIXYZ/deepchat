<template>
  <div class="flex h-full min-h-0 w-full flex-row overflow-hidden">
    <div
      class="relative flex h-full min-h-0 min-w-0 w-0 flex-1 transition-[width] duration-200 ease-out"
    >
      <template v-if="isReady">
        <AgentWelcomePage
          v-if="pageRouter.currentRoute === 'newThread' && agentStore.selectedAgentId === null"
        />
        <NewThreadPage v-else-if="pageRouter.currentRoute === 'newThread'" />
        <ChatPage
          v-else-if="pageRouter.currentRoute === 'chat' && pageRouter.chatSessionId"
          :session-id="pageRouter.chatSessionId"
        />
      </template>

      <Transition name="collapsed-new-chat-button">
        <div
          v-if="showCollapsedNewChatButton"
          class="pointer-events-none absolute inset-x-0 top-0 z-30 h-12"
        >
          <Button
            variant="ghost"
            size="icon"
            data-testid="collapsed-new-chat-button"
            class="collapsed-new-chat-button pointer-events-auto absolute left-4 top-2.5 h-7 w-7 text-muted-foreground hover:text-foreground"
            :title="t('common.newChat')"
            :aria-label="t('common.newChat')"
            @click="handleCollapsedNewChat"
          >
            <Icon icon="lucide:plus" class="h-4 w-4" />
          </Button>
        </div>
      </Transition>
    </div>

    <ChatSidePanel
      :session-id="pageRouter.currentRoute === 'chat' ? pageRouter.chatSessionId : null"
      :workspace-path="sessionStore.activeSession?.projectDir ?? null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useI18n } from 'vue-i18n'
import { createConfigClient } from '@api/ConfigClient'
import { createStartupClient } from '@api/StartupClient'
import ChatSidePanel from '@/components/sidepanel/ChatSidePanel.vue'
import NewThreadPage from '@/pages/NewThreadPage.vue'
import ChatPage from '@/pages/ChatPage.vue'
import AgentWelcomePage from '@/pages/AgentWelcomePage.vue'
import { useModelStore } from '@/stores/modelStore'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useSidebarStore } from '@/stores/ui/sidebar'
import { useProjectStore } from '@/stores/ui/project'
import { markStartupInteractive, scheduleStartupDeferredTask } from '@/lib/startupDeferred'

const { t } = useI18n()
const pageRouter = usePageRouterStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const sidebarStore = useSidebarStore()
const projectStore = useProjectStore()
const modelStore = useModelStore()
const configClient = createConfigClient()
const isReady = ref(false)
let cancelDeferredHydration: (() => void) | null = null
const showCollapsedNewChatButton = computed(
  () =>
    isReady.value && sidebarStore.collapsed && Boolean(sessionStore.newConversationTargetAgentId)
)

const handleCollapsedNewChat = () => {
  void sessionStore.startNewConversation({ refresh: true })
}

const resolveWarmupProviderId = async (): Promise<string | null> => {
  const activeSessionProviderId = sessionStore.activeSession?.providerId?.trim()
  if (activeSessionProviderId) {
    return activeSessionProviderId
  }

  const preferredModel = (await configClient.getSetting('preferredModel')) as
    | { providerId?: string | null }
    | undefined
  const preferredProviderId = preferredModel?.providerId?.trim()
  if (preferredProviderId) {
    return preferredProviderId
  }

  const defaultModel = (await configClient.getSetting('defaultModel')) as
    | { providerId?: string | null }
    | undefined
  const defaultProviderId = defaultModel?.providerId?.trim()
  if (defaultProviderId) {
    return defaultProviderId
  }

  return null
}

const warmStartupModelProvider = async () => {
  try {
    const providerId = await resolveWarmupProviderId()
    if (!providerId) {
      return
    }

    console.info(`[Startup][Renderer] startup.provider.warmup.deferred provider=${providerId}`)
    await modelStore.refreshProviderModels(providerId)
  } catch (error) {
    console.warn('[Startup][Renderer] ChatTabView model warmup failed:', error)
  }
}

const initializeRouteFromFallbackState = async () => {
  const fallbackActiveSessionId = sessionStore.error ? null : (sessionStore.activeSessionId ?? null)
  if (fallbackActiveSessionId) {
    await pageRouter.initialize({
      activeSessionId: fallbackActiveSessionId
    })
    return
  }

  await pageRouter.initialize()
}

onMounted(async () => {
  console.info('[Startup][Renderer] ChatTabView critical hydration begin')
  let shouldRefreshAgentsInDeferred = true

  try {
    const startupClient = createStartupClient()
    const bootstrap = await startupClient.getBootstrap()
    console.info(
      `[Startup][Renderer] startup.bootstrap.ready run=${bootstrap.startupRunId} agents=${bootstrap.agents.length} activeSession=${bootstrap.activeSessionId ?? 'none'}`
    )

    await sessionStore.applyBootstrapShell({
      activeSessionId: bootstrap.activeSessionId,
      activeSession: bootstrap.activeSession ?? null
    })
    agentStore.applyBootstrapAgents(bootstrap.agents)
    projectStore.applyBootstrapDefaultProjectPath(bootstrap.defaultProjectPath)

    await pageRouter.initialize({
      activeSessionId: bootstrap.activeSessionId
    })
  } catch (error) {
    console.warn('[Startup][Renderer] ChatTabView critical hydration failed:', error)
    await Promise.allSettled([agentStore.fetchAgents(), projectStore.loadDefaultProjectPath()])
    shouldRefreshAgentsInDeferred = false
    await initializeRouteFromFallbackState()
  } finally {
    isReady.value = true
    console.info('[Startup][Renderer] ChatTabView interactive ready')

    console.info('[Startup][Renderer] startup.session.first-page.begin')
    await sessionStore.fetchSessions()
    const sessionCount = Array.isArray((sessionStore as { sessions?: unknown[] }).sessions)
      ? sessionStore.sessions.length
      : 0
    console.info(`[Startup][Renderer] startup.session.first-page.ready count=${sessionCount}`)

    markStartupInteractive()
    cancelDeferredHydration = scheduleStartupDeferredTask(async () => {
      console.info('[Startup][Renderer] ChatTabView deferred hydration begin')
      await Promise.allSettled([
        shouldRefreshAgentsInDeferred ? agentStore.fetchAgents() : Promise.resolve(),
        projectStore.fetchProjects(),
        warmStartupModelProvider()
      ])
      console.info('[Startup][Renderer] ChatTabView deferred hydration complete')
    })
  }
})

onBeforeUnmount(() => {
  if (cancelDeferredHydration) {
    cancelDeferredHydration()
    cancelDeferredHydration = null
  }
})
</script>

<style>
/* Scrollbar styles */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #d1d5db80;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9ca3af80;
}

.collapsed-new-chat-button-enter-active,
.collapsed-new-chat-button-leave-active {
  transition:
    opacity 200ms ease-out,
    transform 200ms ease-out;
}

.collapsed-new-chat-button-enter-from,
.collapsed-new-chat-button-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.collapsed-new-chat-button-enter-to,
.collapsed-new-chat-button-leave-from {
  opacity: 1;
  transform: translateX(0);
}

.collapsed-new-chat-button {
  -webkit-app-region: no-drag;
  pointer-events: auto;
}
</style>
