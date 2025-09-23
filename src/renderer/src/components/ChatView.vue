<template>
  <div class="flex h-full flex-1 flex-col overflow-hidden">
    <!-- 消息列表区域 -->
    <MessageList
      :key="chatStore.getActiveThreadId() ?? 'default'"
      ref="messageList"
      :messages="chatStore.getMessages()"
      @scroll-bottom="scrollToBottom"
    />

    <!-- 输入框区域 -->
    <div class="flex-none border-t border-border/60 px-4 pb-6 pt-6 sm:px-6">
      <ChatComposer
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
import ChatComposer from './ChatComposer.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { STREAM_EVENTS } from '@/events'
import { useSettingsStore } from '@/stores/settings'

const route = useRoute()
const settingsStore = useSettingsStore()

const messageList = ref<InstanceType<typeof MessageList> | null>(null)
const chatInput = ref<InstanceType<typeof ChatComposer> | null>(null)

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
