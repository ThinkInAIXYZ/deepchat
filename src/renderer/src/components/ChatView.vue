<template>
  <div class="flex flex-col overflow-hidden h-0 flex-1">
    <!-- 消息列表区域 -->
    <MessageList
      :key="chatStore.getActiveThreadId() ?? 'default'"
      ref="messageList"
      :messages="chatStore.getMessages()"
      @scroll-bottom="scrollToBottom"
    />

    <!-- 输入框区域 -->
    <div class="flex-none px-2 pb-2">
      <ChatInput
        :disabled="!chatStore.getActiveThreadId() || isGenerating"
        :is-agent-mode="isAgentMode"
        :agent-id="agentId"
        :agent-config="agentConfig"
        @send="handleSend"
        @file-upload="handleFileUpload"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import MessageList from './message/MessageList.vue'
import ChatInput from './ChatInput.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { STREAM_EVENTS } from '@/events'
import { useSettingsStore } from '@/stores/settings'
import type { AgentConfig } from '@shared/agent'

// Props for Agent mode support
interface Props {
  isAgentMode?: boolean
  agentId?: string
  agentConfig?: AgentConfig | null
}

const props = withDefaults(defineProps<Props>(), {
  isAgentMode: false,
  agentId: '',
  agentConfig: null
})

const route = useRoute()
const settingsStore = useSettingsStore()

const messageList = ref()

import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

const scrollToBottom = (smooth = true) => {
  messageList.value?.scrollToBottom(smooth)
}
const isGenerating = computed(() => {
  if (!chatStore.getActiveThreadId()) return false
  return chatStore.generatingThreadIds.has(chatStore.getActiveThreadId()!)
})
const handleSend = async (msg: UserMessageContent) => {
  if (messageList.value) {
    // 在发送消息前将aboveThreshold设置为false，确保消息发送过程中总是滚动到底部
    messageList.value.aboveThreshold = false
  }
  scrollToBottom()

  // 检查是否是 Agent 模式
  if (props.isAgentMode && props.agentId) {
    // Agent 模式：使用 agentManager 发送消息
    await sendAgentMessage(msg)
  } else {
    // 普通聊天模式：使用 chatStore 发送消息
    await chatStore.sendMessage(msg)
  }

  // 只有当用户在底部时才自动滚动
  if (!messageList.value?.aboveThreshold) {
    scrollToBottom()
  }
}

// Agent 模式的消息发送逻辑
const sendAgentMessage = async (msg: UserMessageContent) => {
  try {
    console.log('=== Agent Message Send Debug ===')
    console.log('Agent ID:', props.agentId)
    console.log('Agent Config:', props.agentConfig)
    console.log('Is Agent Mode:', props.isAgentMode)

    // 确保有活跃的 thread
    if (!chatStore.getActiveThreadId()) {
      console.log('Creating new Agent thread...')
      const providerId = `agent:${props.agentId}`
      const threadSettings = {
        providerId: providerId,
        modelId: 'datlas-agent',
        artifacts: 0 as 0 | 1
      }

      console.log('Thread settings:', threadSettings)

      // 为 Agent 创建新的 thread，使用特殊的 provider ID 来标识这是 Agent 会话
      const threadId = await chatStore.createThread(`Agent Chat - ${props.agentConfig?.name || 'Agent'}`, threadSettings)
      console.log('Created thread with ID:', threadId)
      chatStore.setActiveThread(threadId)
    } else {
      console.log('Using existing thread:', chatStore.getActiveThreadId())
    }

    // 发送消息
    console.log('Sending message content:', msg)
    await chatStore.sendMessage(msg)

    console.log('Agent message sent successfully')
  } catch (error) {
    console.error('Failed to send agent message:', error)
    throw error
  }
}

const handleFileUpload = () => {
  scrollToBottom()
}

// 监听流式响应
onMounted(async () => {
  window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
    // console.log('stream-response', msg)
    chatStore.handleStreamResponse(msg)
  })

  window.electron.ipcRenderer.on(STREAM_EVENTS.END, (_, msg) => {
    chatStore.handleStreamEnd(msg)
  })

  window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, (_, msg) => {
    chatStore.handleStreamError(msg)
  })

  if (route.query.modelId && route.query.providerId) {
    const threadId = await chatStore.createThread('新会话', {
      modelId: route.query.modelId as string,
      providerId: route.query.providerId as string,
      artifacts: settingsStore.artifactsEffectEnabled ? 1 : 0
    })
    chatStore.setActiveThread(threadId)
  }
})

// 监听路由变化，创建新线程
watch(
  () => route.query,
  async () => {
    if (route.query.modelId && route.query.providerId) {
      const threadId = await chatStore.createThread('新会话', {
        modelId: route.query.modelId as string,
        providerId: route.query.providerId as string,
        artifacts: settingsStore.artifactsEffectEnabled ? 1 : 0
      })
      chatStore.setActiveThread(threadId)
    }
  }
)

// 清理事件监听
onUnmounted(async () => {
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.RESPONSE)
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.END)
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.ERROR)
})
</script>
