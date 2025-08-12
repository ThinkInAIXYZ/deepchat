<template>
  <div class="agent-tab-view w-full h-full flex flex-col">
    <!-- Debug Info (remove in production) -->
    <div class="debug-info bg-muted/50 p-2 text-xs border-b">
      <div>
        Route: {{ route.path }} | Query Type: {{ route.query.type }} | Query ID:
        {{ route.query.id }}
      </div>
      <div>Agent Type: {{ agentType }} | Agent ID: {{ agentId }}</div>
      <div>
        Config: {{ agentConfig ? agentConfig.name : 'None' }} | Status:
        {{ agentStatus.isOk ? 'OK' : 'Error' }}
      </div>
    </div>

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
        <p class="text-sm text-muted-foreground">
          {{ agentConfig?.description || 'Agent Assistant' }}
        </p>
      </div>
      <div class="agent-status">
        <Badge :variant="agentStatus.isOk ? 'default' : 'destructive'">
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

      <!-- Claude CLI Agent Interface -->
      <TerminalAgentView
        v-else-if="agentType === 'claude-cli'"
        :agent-id="agentId"
        :config="agentConfig as any"
        class="h-full"
      />

      <!-- Default Chat Agent Interface -->
      <ChatTabView v-else-if="agentType === 'chat'" class="h-full" />

      <!-- Custom Agent Interface -->
      <div v-else class="h-full flex items-center justify-center text-muted-foreground">
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
import { ref, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Badge } from '@/components/ui/badge'
import { usePresenter } from '@/composables/usePresenter'
import ChatTabView from './ChatTabView.vue'
import DatlasAgentView from '@/components/agent/DatlasAgentView.vue'
import TerminalAgentView from '@/components/agent/TerminalAgentView.vue'
import type { AgentConfig, AgentType } from '@shared/agent'

const route = useRoute()
const router = useRouter()
const agentManager = usePresenter('agentManager')

// Agent 信息
const agentType = ref<AgentType>('chat')
const agentId = ref<string>('')
const agentConfig = ref<AgentConfig | null>(null)
const agentStatus = ref({ isOk: false, errorMsg: null as string | null })

// 从路由参数获取 Agent 信息
const parseAgentFromRoute = () => {
  const query = route.query
  console.log('=== parseAgentFromRoute called ===')
  console.log('Route query parameters:', query)
  console.log('Route path:', route.path)
  console.log('Route name:', route.name)
  console.log('Current agentType before update:', agentType.value)
  console.log('Current agentId before update:', agentId.value)

  if (query.type && query.id) {
    const oldType = agentType.value
    const oldId = agentId.value
    agentType.value = query.type as AgentType
    agentId.value = query.id as string
    console.log(
      `✅ Agent tab initialized with type: ${oldType} -> ${agentType.value}, id: ${oldId} -> ${agentId.value}`
    )
  } else {
    // 默认为 chat agent
    agentType.value = 'chat'
    agentId.value = 'default-chat'
    console.log('❌ Agent tab initialized with default chat mode, no query params found')
    console.log('Available query keys:', Object.keys(query))
    console.log('Query.type:', query.type, 'Query.id:', query.id)
  }
  console.log('=== parseAgentFromRoute completed ===')
}

// 加载 Agent 配置
const loadAgentConfig = async () => {
  try {
    console.log(`Loading agent config for: ${agentId.value} (type: ${agentType.value})`)

    // 对于 chat 类型的 agent，使用默认配置
    if (agentType.value === 'chat') {
      agentConfig.value = {
        id: agentId.value,
        name: 'Chat Assistant',
        type: 'chat',
        enabled: true,
        config: {},
        icon: 'lucide:message-circle',
        color: '#3b82f6',
        description: 'Default chat assistant'
      }
      agentStatus.value = { isOk: true, errorMsg: null }
      console.log('Using default chat agent config:', agentConfig.value)
      return
    }

    // 对于非 chat 类型的 agent，从系统加载配置
    try {
      const config = await agentManager.getAgent(agentId.value)
      if (config) {
        agentConfig.value = config
        console.log('Agent config loaded:', config)

        // 创建 provider
        try {
          const created = await agentManager.createProvider(agentId.value)
          if (created) {
            console.log(`Created provider for agent: ${agentId.value}`)
          } else {
            console.error(`Failed to create provider for agent ${agentId.value}`)
          }
        } catch (error) {
          console.error(`Failed to create provider for agent ${agentId.value}:`, error)
        }

        // 检查 Agent 状态
        try {
          const status = await agentManager.checkAgent(agentId.value)
          agentStatus.value = status
          console.log(`Agent ${agentId.value} status:`, status)
        } catch (error) {
          console.error(`Failed to check agent status for ${agentId.value}:`, error)
          agentStatus.value = { isOk: false, errorMsg: 'Failed to check agent status' }
        }
      } else {
        console.error(`Agent not found: ${agentId.value}`)
        agentStatus.value = { isOk: false, errorMsg: 'Agent not found' }
      }
    } catch (error) {
      console.error(`Failed to load agent config for ${agentId.value}:`, error)
      agentStatus.value = { isOk: false, errorMsg: 'Failed to load agent config' }
    }
  } catch (error) {
    console.error('Failed to load agent config:', error)
    agentStatus.value = { isOk: false, errorMsg: 'Failed to load agent config' }
  }
}

// 监听路由变化
watch(
  () => route.query,
  (newQuery, oldQuery) => {
    console.log('Route query changed from:', oldQuery, 'to:', newQuery)
    parseAgentFromRoute()
    loadAgentConfig()
  },
  { immediate: true, deep: true }
)

// 监听整个路由对象的变化
watch(
  () => route,
  (newRoute, oldRoute) => {
    console.log(
      'Route changed from:',
      oldRoute?.path,
      oldRoute?.query,
      'to:',
      newRoute.path,
      newRoute.query
    )
  },
  { immediate: true, deep: true }
)

onMounted(async () => {
  console.log('AgentTabView mounted, current route:', route.path, route.query)
  console.log(
    'Router current route:',
    router.currentRoute.value.path,
    router.currentRoute.value.query
  )

  // 延迟一下再解析，确保路由完全加载
  await nextTick()
  console.log('After nextTick, route:', route.path, route.query)

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
