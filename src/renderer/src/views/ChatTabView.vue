<template>
  <div class="flex h-full w-full flex-row overflow-hidden">
    <div class="flex h-full min-w-0 w-0 flex-1 transition-[width] duration-200 ease-out">
      <template v-if="isReady">
        <NewThreadPage v-if="pageRouter.currentRoute === 'newThread'" />
        <ChatPage
          v-else-if="pageRouter.currentRoute === 'chat' && pageRouter.chatSessionId"
          :session-id="pageRouter.chatSessionId"
        />
      </template>
    </div>

    <ChatSidePanel
      :session-id="pageRouter.currentRoute === 'chat' ? pageRouter.chatSessionId : null"
      :workspace-path="sessionStore.activeSession?.projectDir ?? null"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ChatSidePanel from '@/components/sidepanel/ChatSidePanel.vue'
import NewThreadPage from '@/pages/NewThreadPage.vue'
import ChatPage from '@/pages/ChatPage.vue'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import { useModelStore } from '@/stores/modelStore'

const pageRouter = usePageRouterStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const modelStore = useModelStore()
const isReady = ref(false)

onMounted(async () => {
  try {
    await Promise.all([
      pageRouter.initialize(),
      sessionStore.fetchSessions(),
      agentStore.fetchAgents(),
      modelStore.initialize(),
      projectStore.fetchProjects()
    ])
  } finally {
    isReady.value = true
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
</style>
