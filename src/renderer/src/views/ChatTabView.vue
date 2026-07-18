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
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createStartupClient } from '@api/StartupClient'
import type { RendererStartupWorkloadTaskId } from '@shared/contracts/routes'
import ChatSidePanel from '@/components/sidepanel/ChatSidePanel.vue'
import AgentBrowserPiP from '@/components/browser/AgentBrowserPiP.vue'
import NewThreadPage from '@/pages/NewThreadPage.vue'
import ChatPage from '@/features/chat-page/ChatPage.vue'
import AgentWelcomePage from '@/pages/AgentWelcomePage.vue'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useStartupWorkloadStore } from '@/stores/startupWorkloadStore'
import { markStartupInteractive, scheduleStartupDeferredTask } from '@/lib/startupDeferred'
import {
  RENDERER_PERFORMANCE_REPORTER,
  type RendererPerformanceReporter,
  type StartupWorkloadTaskSnapshot
} from '@/platform/performance/rendererPerformance'

const pageRouter = usePageRouterStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const modelStore = useModelStore()
const ollamaStore = useOllamaStore()
const performanceReporter = inject<RendererPerformanceReporter | null>(
  RENDERER_PERFORMANCE_REPORTER,
  null
)
let startupWorkloadStore: ReturnType<typeof useStartupWorkloadStore> | null = null

try {
  startupWorkloadStore = useStartupWorkloadStore()
} catch (error) {
  console.warn('[Startup][Renderer] startupWorkloadStore unavailable in ChatTabView', error)
}
const isReady = ref(false)
let cancelDeferredHydration: (() => void) | null = null

function isRendererStartupWorkloadTaskId(taskId: string): taskId is RendererStartupWorkloadTaskId {
  return (
    taskId === 'main.bootstrap' ||
    taskId === 'main.session.firstPage' ||
    taskId === 'main.provider.warmup'
  )
}

watch(
  () => ({
    startupRunId: startupWorkloadStore?.runIds.main ?? null,
    tasks: startupWorkloadStore?.mainTasks ?? []
  }),
  ({ startupRunId, tasks }) => {
    const mainTasks: StartupWorkloadTaskSnapshot[] = []
    for (const task of tasks) {
      if (!isRendererStartupWorkloadTaskId(task.id)) continue
      mainTasks.push({
        id: task.id,
        state: task.state,
        startedAt: task.startedAt,
        updatedAt: task.updatedAt
      })
    }
    performanceReporter?.observeStartupWorkload(startupRunId, mainTasks)
  },
  { deep: true }
)

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
    performanceReporter?.recordStartup('bootstrap-ready', {
      startupRunId: bootstrap.startupRunId
    })
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
    performanceReporter?.recordStartup('route-ready')

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
    performanceReporter?.recordStartup('bootstrap-fallback', {
      fallback: true,
      outcome: 'failed'
    })
    console.warn('[Startup][Renderer] ChatTabView critical hydration failed:', error)
    await Promise.allSettled([agentStore.fetchAgents(), projectStore.loadDefaultProjectPath()])
    await initializeRouteFromFallbackState()
    performanceReporter?.recordStartup('route-ready', { fallback: true })
  } finally {
    // The route host owns the initial session request. It must start after bootstrap shell
    // hydration (or fallback route recovery), otherwise its single-flight request can lose
    // the bootstrap active session priority.
    if (!sessionStore.hasLoadedInitialPage) {
      void sessionStore.fetchSessions()
    }

    isReady.value = true
    performanceReporter?.recordStartup('interactive')
    console.info('[Startup][Renderer] ChatTabView interactive ready')

    markStartupInteractive()
    cancelDeferredHydration = scheduleStartupDeferredTask(async () => {
      console.info('[Startup][Renderer] ChatTabView deferred hydration begin')
      // Wait for critical loads if they're still running
      if (criticalLoadPromises) {
        await criticalLoadPromises
      }
      performanceReporter?.recordStartup('deferred-settled')
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
