<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- 消息列表区域 -->
    <MessageList
      :key="chatStore.activeThreadId ?? 'default'"
      ref="messageList"
      :messages="chatStore.messages"
      @scroll-bottom="scrollToBottom"
    />

    <!-- 输入框区域 -->
    <div class="flex-none p-2">
      <ChatInput
        :disabled="!chatStore.activeThreadId || isGenerating"
        @send="handleSend"
        @file-upload="handleFileUpload"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import MessageList from './message/MesasgeList.vue'
import ChatInput from './ChatInput.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { STREAM_EVENTS } from '@/events'

const route = useRoute()

const messageList = ref()

import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

const scrollToBottom = (smooth = true) => {
  messageList.value?.scrollToBottom(smooth)
}
const isGenerating = computed(() => {
  if (!chatStore.activeThreadId) return false
  return chatStore.generatingThreadIds.has(chatStore.activeThreadId)
})

// 确保在聊天相关交互时关闭预览窗口
const closeArtifactsPreviewIfExists = () => {
  if (window.closeArtifactsPreview) {
    window.closeArtifactsPreview()
  }
}

const handleSend = async (content: UserMessageContent) => {
  // 先关闭预览窗口
  closeArtifactsPreviewIfExists()
  
  // 原有发送消息逻辑
  try {
    await chatStore.sendMessage(content)
    scrollToBottom()
  } catch (error) {
    console.error('发送消息失败', error)
  }
}

const handleFileUpload = () => {
  // 先关闭预览窗口
  closeArtifactsPreviewIfExists()
  
  // 原有上传文件逻辑
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
      providerId: route.query.providerId as string
    })
    chatStore.setActiveThread(threadId)
  }
})

watch(
  () => route.query,
  async () => {
    if (route.query.modelId && route.query.providerId) {
      const threadId = await chatStore.createThread('新会话', {
        modelId: route.query.modelId as string,
        providerId: route.query.providerId as string
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
