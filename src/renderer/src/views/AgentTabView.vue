<template>
  <div class="agent-tab-view h-full flex flex-col">
    <!-- Agent Header -->
    <div class="agent-header border-b border-border p-4 flex items-center gap-3">
      <div class="agent-icon">
        <Icon
          :icon="agentConfig?.icon || 'lucide:database'"
          class="w-6 h-6"
          :style="{ color: agentConfig?.color || '#10b981' }"
        />
      </div>
      <div class="agent-info flex-1">
        <h2 class="text-lg font-semibold">{{ agentConfig?.name || 'Agent' }}</h2>
        <p class="text-sm text-muted-foreground">{{ agentConfig?.description || 'Agent Assistant' }}</p>
      </div>
      <div class="agent-status">
        <Badge
          :variant="agentStatus.isOk ? 'default' : 'destructive'"
        >
          {{ agentStatus.isOk ? 'Connected' : 'Disconnected' }}
        </Badge>
      </div>
    </div>

    <!-- Agent Content -->
    <div class="agent-content flex-1 overflow-hidden">
      <!-- Datlas Agent Interface -->
      <DatlasAgentView
        v-if="agentType === 'datlas'"
        :agent-id="agentId"
        :config="agentConfig"
        class="h-full"
      />

      <!-- Default Chat Agent Interface -->
      <ChatTabView
        v-else-if="agentType === 'chat'"
        class="h-full"
      />

      <!-- Custom Agent Interface -->
      <div
        v-else
        class="h-full flex items-center justify-center text-muted-foreground"
      >
        <div class="text-center">
          <Icon icon="lucide:bot" class="w-16 h-16 mx-auto mb-4 opacity-50" />
          <h3 class="text-lg font-medium mb-2">{{ agentConfig?.name || 'Custom Agent' }}</h3>
          <p class="text-sm">Agent interface not implemented yet</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Badge } from '@/components/ui/badge'
import { usePresenter } from '@/composables/usePresenter'
import ChatTabView from './ChatTabView.vue'
import DatlasAgentView from '@/components/agent/DatlasAgentView.vue'
import type { AgentConfig, AgentType } from '@shared/agent'

const route = useRoute()
const agentManager = usePresenter('agentManager')

// Agent 信息
const agentType = ref<AgentType>('chat')
const agentId = ref<string>('')
const agentConfig = ref<AgentConfig | null>(null)
const agentStatus = ref({ isOk: false, errorMsg: null })

// 从路由参数获取 Agent 信息
const parseAgentFromRoute = () => {
  const query = route.query
  if (query.type && query.id) {
    agentType.value = query.type as AgentType
    agentId.value = query.id as string
  } else {
    // 默认为 chat agent
    agentType.value = 'chat'
    agentId.value = 'default-chat'
  }
}

// 加载 Agent 配置
const loadAgentConfig = async () => {
  try {
    const config = await agentManager.getAgent(agentId.value)
    if (config) {
      agentConfig.value = config
      // 检查 Agent 状态
      const status = await agentManager.checkAgent(agentId.value)
      agentStatus.value = status
    } else {
      console.error(`Agent not found: ${agentId.value}`)
    }
  } catch (error) {
    console.error('Failed to load agent config:', error)
  }
}

// 计算属性：是否显示 Agent 界面
const showAgentInterface = computed(() => {
  return agentType.value !== 'chat' && agentConfig.value
})

onMounted(async () => {
  parseAgentFromRoute()
  await loadAgentConfig()
})
</script>

<style scoped>
.agent-tab-view {
  background: var(--background);
  color: var(--foreground);
}

.agent-header {
  background: var(--card);
}

.agent-content {
  background: var(--background);
}

.agent-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--muted);
}
</style>
