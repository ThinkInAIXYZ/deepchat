<template>
  <div class="w-full max-w-xl mx-auto px-3">
    <div v-if="agents.length > 0" class="text-muted-foreground text-xs pb-3 px-3">Other Agents</div>
    <!-- Agent 卡片网格 -->
    <div
      v-if="agents.length > 0"
      class="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
    >
      <AcpAgentCard
        v-for="agent in agents"
        :key="agent.id"
        :agent="agent"
        :selected="selectedAgentId === agent.id"
        @click="handleAgentClick(agent.id)"
      />
      <AcpAgentAdd @click="handleAgentClick('add-new')" />
    </div>

    <!-- 空状态 -->
    <div v-if="agents.length === 0" class="text-center py-8 text-muted-foreground">
      {{ t('newThread.homepage.acpAgents.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AcpAgentCard from './AcpAgentCard.vue'
import { usePresenter } from '@/composables/usePresenter'
import type { AcpBuiltinAgent, AcpCustomAgent } from '@shared/types/presenters/legacy.presenters'
import AcpAgentAdd from './AcpAgentAdd.vue'

interface Props {
  selectedAgentId?: string | null
}

defineProps<Props>()

interface Emits {
  (e: 'agent-click', agentId: string): void
}

const emit = defineEmits<Emits>()

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')

const agents = ref<Array<AcpBuiltinAgent | AcpCustomAgent>>([])

// 加载 agents
const loadAgents = async () => {
  try {
    const [builtins, customs] = await Promise.all([
      configPresenter.getAcpBuiltinAgents(),
      configPresenter.getAcpCustomAgents()
    ])
    // 只显示已启用的 agents
    agents.value = [...builtins, ...customs].filter((agent) => agent.enabled)
  } catch (error) {
    console.error('Failed to load ACP agents:', error)
    agents.value = []
  }
}

// 处理 agent 点击
const handleAgentClick = (agentId: string) => {
  emit('agent-click', agentId)
}

onMounted(() => {
  loadAgents()
})
</script>
