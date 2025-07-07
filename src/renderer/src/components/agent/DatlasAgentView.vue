<template>
  <div class="datlas-agent-view h-full flex flex-col">
    <!-- Chat Interface -->
    <div class="chat-container flex-1 overflow-hidden">
      <ChatView :is-agent-mode="true" :agent-id="agentId" :agent-config="config" class="h-full" />
    </div>

    <!-- Agent-specific features -->
    <div v-if="showAgentFeatures" class="agent-features border-t border-border p-4">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon icon="lucide:database" class="w-4 h-4" />
        <span>Knowledge Base Retrieval Active</span>
        <Badge variant="secondary" class="ml-auto"> Datlas RAG </Badge>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Badge } from '@/components/ui/badge'
import ChatView from '@/components/ChatView.vue'
import type { AgentConfig } from '@shared/agent'

interface Props {
  agentId: string
  config: AgentConfig | null
}

const props = defineProps<Props>()

// 显示 Agent 特色功能
const showAgentFeatures = computed(() => {
  return props.config?.type === 'datlas' && props.config?.enabled
})
</script>

<style scoped>
.datlas-agent-view {
  background: var(--background);
}

.agent-features {
  background: var(--card);
}
</style>
