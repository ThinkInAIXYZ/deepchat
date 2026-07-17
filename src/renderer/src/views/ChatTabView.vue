<template>
  <div class="relative flex h-full min-h-0 w-full flex-row overflow-hidden">
    <div class="relative flex h-full min-h-0 min-w-0 w-0 flex-1">
      <template v-if="isReady">
        <!--
          Wrapper is a real DOM root for page components whose root may be a provider/fragment.
          Avoid a full ChatPage route transition here: fading a large scrollable message tree
          forces expensive compositing during conversation switches.
        -->
        <div
          v-if="pageRouter.currentRoute === 'newThread' && agentStore.selectedAgentId === null"
          key="agent-welcome"
          class="chat-route-shell flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <AgentWelcomePage />
        </div>
        <div
          v-else-if="pageRouter.currentRoute === 'newThread'"
          key="new-thread"
          class="chat-route-shell flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <NewThreadPage />
        </div>
        <div
          v-else-if="pageRouter.currentRoute === 'chat' && pageRouter.chatSessionId"
          :key="pageRouter.chatSessionId"
          class="chat-route-shell flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <ChatPage :session-id="pageRouter.chatSessionId" />
        </div>
      </template>
      <AgentBrowserPiP
        :session-id="pageRouter.currentRoute === 'chat' ? pageRouter.chatSessionId : null"
      />
    </div>

    <ChatSidePanel
      :session-id="pageRouter.currentRoute === 'chat' ? pageRouter.chatSessionId : null"
      :workspace-path="sessionStore.activeSession?.projectDir ?? null"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createStartupClient } from '@api/StartupClient'
import ChatSidePanel from '@/components/sidepanel/ChatSidePanel.vue'
import AgentBrowserPiP from '@/components/browser/AgentBrowserPiP.vue'
import NewThreadPage from '@/pages/NewThreadPage.vue'
import ChatPage from '@/pages/ChatPage.vue'
import AgentWelcomePage from '@/pages/AgentWelcomePage.vue'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useStartupWorkloadStore } from '@/stores/startupWorkloadStore'
import { markStartupInteractive, scheduleStartupDeferredTask } from '@/lib/startupDeferred'

const pageRouter = usePageRouterStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const modelStore = useModelStore()
const ollamaStore = useOllamaStore()
let startupWorkloadStore: ReturnType<typeof useStartupWorkloadStore> | null = null

try {
  startupWorkloadStore = useStartupWorkloadStore()
} catch (error) {
  console.warn('[Startup][Renderer] startupWorkloadStore unavailable in ChatTabView', error)
}
const isReady = ref(false)
let cancelDeferredHydration: (() => void) | null = null

const initializeRouteFromFallbackState = async () => {
  if (sessionStore.error) {
    await pageRouter.initialize()
    return
  }

  await pageRouter.initialize({
    activeSessionId: sessionStore.activeSessionId ?? null
  })
}

onMounted(async () => {
  startupWorkloadStore?.connect()
  console.info('[Startup][Renderer] ChatTabView critical hydration begin')
  let criticalLoadPromises: Promise<void> | null = null

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
    projectStore.applyBootstrapDefaultProjectPath(
      bootstrap.defaultProjectPath,
      bootstrap.defaultChatWorkspacePath ?? null
    )

    await pageRouter.initialize({
      activeSessionId: bootstrap.activeSessionId
    })

    // Start loading agents, projects, models, and ollama immediately after router init
    // Don't block on them, they load in background while we mark interactive
    criticalLoadPromises = Promise.allSettled([
      agentStore.fetchAgents(),
      projectStore.fetchProjects(),
      modelStore.initialize(),
      ollamaStore.initialize()
    ]).then(() => {
      console.info('[Startup][Renderer] ChatTabView critical loads complete')
    })
  } catch (error) {
    console.warn('[Startup][Renderer] ChatTabView critical hydration failed:', error)
    await Promise.allSettled([agentStore.fetchAgents(), projectStore.loadDefaultProjectPath()])
    await initializeRouteFromFallbackState()
  } finally {
    isReady.value = true
    console.info('[Startup][Renderer] ChatTabView interactive ready')

    // Session data is already loading in parallel from App.vue.onMounted
    // Don't block on it here - let it load in background
    if (!sessionStore.hasLoadedInitialPage) {
      void sessionStore.fetchSessions()
    }

    markStartupInteractive()
    cancelDeferredHydration = scheduleStartupDeferredTask(async () => {
      console.info('[Startup][Renderer] ChatTabView deferred hydration begin')
      // Wait for critical loads if they're still running
      if (criticalLoadPromises) {
        await criticalLoadPromises
      }
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

<style scoped>
/*
 * TooltipProvider renders no DOM node, so the page's real root is the shell's
 * direct child. Stretch that child without forcing display (NewThread needs flex).
 */
.chat-route-shell > :deep(*) {
  height: 100%;
  min-height: 0;
  min-width: 0;
  flex: 1 1 0%;
}
</style>
