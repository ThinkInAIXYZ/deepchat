<template>
  <div :class="['flex flex-col overflow-hidden h-0 flex-1', chatContentClasses]">
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
        ref="chatInput"
        :disabled="!chatStore.getActiveThreadId() || isGenerating"
        @send="handleSend"
        @file-upload="handleFileUpload"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import MessageList from './message/MessageList.vue'
import ChatInput from './ChatInput.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { STREAM_EVENTS } from '@/events'
import { useSettingsStore } from '@/stores/settings'

import { useChatWidthStore } from '../stores/chatWidth'
import { ChatWidthMode } from '../../../constants/chatWidthModes'

const chatWidthStore = useChatWidthStore()
const chatContentClasses = computed(() => {
  switch (chatWidthStore.chatWidthMode) {
    case ChatWidthMode.NARROW:
      return 'max-w-3xl mx-auto min-w-[48rem]'
    case ChatWidthMode.MEDIUM:
      return 'max-w-4xl mx-auto min-w-[56rem]'
    case ChatWidthMode.WIDE:
      return 'max-w-7xl mx-auto min-w-[80rem]'
    case ChatWidthMode.FULL:
      return 'max-w-full mx-auto min-w-full'
    default:
      return 'max-w-4xl mx-auto min-w-[56rem]'
  }
})

const route = useRoute()
const settingsStore = useSettingsStore()

const messageList = ref()
const chatInput = ref()

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
  scrollToBottom()
  await chatStore.sendMessage(msg)
  setTimeout(() => {
    chatInput.value?.restoreFocus()
  }, 100)
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
    // 当用户没有主动向上滚动时才自动滚动到底部
    nextTick(() => {
      if (messageList.value && !messageList.value.aboveThreshold) {
        scrollToBottom(false)
      }
    })
    setTimeout(() => {
      chatInput.value?.restoreFocus()
    }, 200)
  })

  window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, (_, msg) => {
    chatStore.handleStreamError(msg)
    setTimeout(() => {
      chatInput.value?.restoreFocus()
    }, 200)
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

defineExpose({
  messageList
})
</script>
