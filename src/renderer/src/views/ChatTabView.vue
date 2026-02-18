<template>
  <div class="w-full h-full flex-row flex">
    <div class="flex-1 w-0 h-full">
      <div class="flex h-full">
        <!-- Main content area -->
        <div class="flex-1 flex flex-col w-0">
          <WelcomePage v-if="pageRouter.currentRoute === 'welcome'" />
          <NewThreadPage v-else-if="pageRouter.currentRoute === 'newThread'" />
          <ChatPage
            v-else-if="pageRouter.currentRoute === 'chat' && pageRouter.chatSessionId"
            :session-id="pageRouter.chatSessionId"
          />
        </div>
      </div>
    </div>

    <!-- Artifacts preview area -->
    <ArtifactDialog />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
import WelcomePage from '@/pages/WelcomePage.vue'
import NewThreadPage from '@/pages/NewThreadPage.vue'
import ChatPage from '@/pages/ChatPage.vue'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'

const pageRouter = usePageRouterStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()

onMounted(async () => {
  await Promise.all([
    pageRouter.initialize(),
    sessionStore.fetchSessions(),
    agentStore.fetchAgents()
  ])
  projectStore.deriveFromSessions(sessionStore.sessions)
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
</style>
