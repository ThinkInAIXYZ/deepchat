<template>
  <div class="h-full w-full flex flex-col items-center justify-start overflow-y-auto">
    <div>
      <img
        src="../assets/logo-transparent.svg"
        alt="DeepChat Logo"
        class="w-24 h-24 mt-16 opacity-80"
        draggable="false"
      />
    </div>
    <div class="font-bold">DeepChat Agent</div>
    <div class="w-full flex-1 flex flex-col items-center py-8 gap-3">
      <!-- 简化输入框 -->
      <ChatInput
        ref="chatInputRef"
        variant="newThread"
        :model-info="selectedModelInfo"
        @send="handleSend"
        @model-update="handleModelUpdate"
      />
      <!-- ACP Agent 网格 -->
      <AcpAgentGrid :selected-agent-id="selectedAgentId" @agent-click="handleAgentClick" />
    </div>

    <!-- 配置对话框 -->
    <AcpAgentConfigDialog
      v-model:open="showAgentConfigDialog"
      :agent-id="selectedAgentId"
      :agent-name="selectedAgentName"
      @confirm="handleAcpStart"
    />
  </div>
</template>

<script setup lang="ts">
import ChatInput from './chat-input/ChatInput.vue'
import AcpAgentGrid from './homepage/AcpAgentGrid.vue'
import AcpAgentConfigDialog from './homepage/AcpAgentConfigDialog.vue'
import { useChatStore } from '@/stores/chat'
import { useWorkspaceStore } from '@/stores/workspace'
import { ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { UserMessageContent } from '@shared/chat'
import type { ModelType } from '@shared/model'
import { useConversationNavigation } from '@/composables/useConversationNavigation'

const chatStore = useChatStore()
const workspaceStore = useWorkspaceStore()
const configPresenter = usePresenter('configPresenter')
const { createAndNavigateToConversation } = useConversationNavigation()

// ChatInput ref
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)

// 选择的模型信息
const selectedModelInfo = ref<{ id: string; providerId: string } | null>(null)

// Agent 选择状态
const selectedAgentId = ref<string | null>(null)
const selectedAgentName = ref<string>('')
const showAgentConfigDialog = ref(false)

// 处理消息发送
const handleSend = async (messageContent: UserMessageContent) => {
  if (!messageContent.text.trim()) return

  try {
    // 创建新线程并导航
    const threadId = await createAndNavigateToConversation(messageContent.text, {
      providerId: selectedModelInfo.value?.providerId,
      modelId: selectedModelInfo.value?.id
    } as any)

    if (threadId) {
      // 发送消息
      await chatStore.sendMessage(messageContent)

      // 清空输入
      chatInputRef.value?.clearContent()
    }
  } catch (error) {
    console.error('Failed to send message:', error)
  }
}

// 处理模型更新
const handleModelUpdate = (
  model: { id: string; name: string; type?: ModelType },
  providerId: string
) => {
  selectedModelInfo.value = {
    id: model.id,
    providerId
  }
}

// Agent 卡片点击
const handleAgentClick = async (agentId: string) => {
  selectedAgentId.value = agentId

  // 获取 agent 名称
  try {
    const agents = await configPresenter.getAcpAgents()
    const agent = agents.find((a) => a.id === agentId)
    selectedAgentName.value = agent?.name || agentId
  } catch (error) {
    console.error('Failed to get agent name:', error)
    selectedAgentName.value = agentId
  }

  showAgentConfigDialog.value = true
}

// ACP 会话启动
const handleAcpStart = async (config: {
  agentId: string
  workdir: string
  modelId?: string
  modeId?: string
}) => {
  try {
    // 创建新线程并导航，配置 ACP agent
    const threadId = await createAndNavigateToConversation('New ACP Session', {
      providerId: 'acp',
      modelId: config.agentId,
      chatMode: 'acp agent',
      acpWorkdirMap: {
        [config.agentId]: config.workdir
      }
    } as any)

    if (threadId) {
      await workspaceStore.refreshFileTree()

      // 更新 ChatInput 的模型选择
      selectedModelInfo.value = {
        id: config.agentId,
        providerId: 'acp'
      }
    }
  } catch (error) {
    console.error('Failed to start ACP session:', error)
  }

  showAgentConfigDialog.value = false
}
</script>
