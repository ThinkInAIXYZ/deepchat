<template>
  <Dialog :open="isOpen" @update:open="updateOpen">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{ t('agent.selectAgentType') }}</DialogTitle>
      </DialogHeader>
      <div class="py-4">
        <div class="space-y-3">
          <div
            v-for="agentType in availableAgentTypes"
            :key="agentType.id"
            class="flex items-center space-x-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-accent/50 transition-colors"
            @click="selectAgent(agentType)"
          >
            <Icon
              :icon="agentType.icon || 'lucide:bot'"
              class="w-8 h-8 flex-shrink-0"
              :style="{ color: agentType.color }"
            />
            <div class="flex-1">
              <h3 class="font-medium">{{ getAgentName(agentType) }}</h3>
              <p class="text-sm text-muted-foreground">{{ getAgentDescription(agentType) }}</p>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePresenter } from '@/composables/usePresenter'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/ui/toast/use-toast'
import type { AgentConfig } from '@shared/agent'

interface Props {
  isOpen: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'agent-selected', agentType: AgentConfig): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const router = useRouter()
const { t } = useI18n()
const { toast } = useToast()
const agentManager = usePresenter('agentManager')

// 可选的 agent 类型
const availableAgentTypes = ref<AgentConfig[]>([])

// 异步加载 agents
const loadAgents = async () => {
  try {
    const allAgents = await agentManager.getAllAgents()
    console.log('Loaded user-configured agents:', allAgents)

    const enabledAgents = allAgents.filter((agent) => agent.enabled)
    console.log('Enabled agents:', enabledAgents)

    // 如果没有配置的 agents，提供默认的 agent 类型选项
    if (enabledAgents.length === 0) {
      console.log('No user agents found, providing default agent types')
      availableAgentTypes.value = [
        {
          id: 'default-chat',
          name: 'Chat Assistant',
          type: 'chat',
          enabled: true,
          config: {},
          icon: 'lucide:message-circle',
          color: '#3b82f6',
          description: 'Default chat assistant'
        },
        {
          id: 'default-claude-cli',
          name: 'Claude CLI',
          type: 'claude-cli' as any,
          enabled: true,
          config: { workingDir: '', extraArgs: '' },
          icon: 'lucide:terminal',
          color: '#0ea5e9',
          description: 'Interactive Claude Code terminal'
        }
      ]
    } else {
      availableAgentTypes.value = enabledAgents
    }

    console.log('Final available agent types:', availableAgentTypes.value)
  } catch (error) {
    console.error('Failed to load agents:', error)
    // 提供默认的 chat agent
    availableAgentTypes.value = [
      {
        id: 'default-chat',
        name: 'Chat Assistant',
        type: 'chat',
        enabled: true,
        config: {},
        icon: 'lucide:message-circle',
        color: '#3b82f6',
        description: 'Default chat assistant'
      }
    ]
  }
}

// 获取 agent 名称（支持国际化）
const getAgentName = (agentType: AgentConfig) => {
  const key = `agent.${agentType.type}Agent`
  const translated = t(key)
  // 如果翻译key不存在，返回原始名称
  return translated === key ? agentType.name : translated
}

// 获取 agent 描述（支持国际化）
const getAgentDescription = (agentType: AgentConfig) => {
  const key = `agent.${agentType.type}AgentDescription`
  const translated = t(key)
  // 如果翻译key不存在，返回原始描述
  return translated === key ? agentType.description : translated
}

// 选择 agent 并跳转路由
const selectAgent = async (agentType: AgentConfig) => {
  console.log('Selected agent:', {
    type: agentType.type,
    id: agentType.id,
    name: agentType.name,
    enabled: agentType.enabled
  })

  try {
    // 所有 agent 类型都跳转到 /agent 路由并传递参数
    const routeParams = {
      name: 'agent',
      query: {
        type: agentType.type,
        id: agentType.id
      }
    }
    console.log('Navigating to agent route with params:', routeParams)
    console.log(
      'Current route before navigation:',
      router.currentRoute.value.path,
      router.currentRoute.value.query
    )

    const result = await router.push(routeParams)
    console.log('Navigation result:', result)
    console.log(
      'Route after navigation:',
      router.currentRoute.value.path,
      router.currentRoute.value.query
    )
    console.log('Navigation completed')

    // 显示成功提示
    toast({
      title: t('agent.agentSelected'),
      description: `${getAgentName(agentType)} ${t('agent.agentSelected').toLowerCase()}`
    })

    // 触发事件并关闭弹窗
    emit('agent-selected', agentType)
    updateOpen(false)
  } catch (error) {
    console.error('Error navigating to agent:', error)
    toast({
      title: t('agent.agentCreationFailed'),
      description: 'Failed to navigate to agent interface.',
      variant: 'destructive'
    })
  }
}

// 更新弹窗状态
const updateOpen = (value: boolean) => {
  emit('update:open', value)
}

// 当弹窗打开时加载 agents
watch(
  () => props.isOpen,
  async (newValue) => {
    if (newValue) {
      await loadAgents()
    }
  },
  { immediate: true }
)
</script>
