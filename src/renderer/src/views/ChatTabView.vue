<template>
  <div class="w-full h-full">
    <!-- 新会话 -->
    <NewThread v-if="!chatStore.getActiveThreadId()" />
    <!-- 聊天内容区域 -->
    <ChatLayout v-else ref="chatViewRef" />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useChatStore } from '@/stores/chat'
import { watch, ref, nextTick } from 'vue'
import { useTitle, useMediaQuery } from '@vueuse/core'
import { useRoute } from 'vue-router'
const ChatLayout = defineAsyncComponent(() => import('@/components/ChatLayout.vue'))
const NewThread = defineAsyncComponent(() => import('@/components/NewThread.vue'))
const route = useRoute()
const chatStore = useChatStore()
const title = useTitle()
const chatViewRef = ref()

// Single WebContents Architecture: Watch route changes to load conversations
watch(
  () => route.params.id,
  async (newId) => {
    if (route.name === 'conversation' && newId) {
      // Load the conversation specified in the route
      await chatStore.setActiveThread(newId as string)
    } else if (route.name === 'home' || !newId) {
      // Clear active thread for home view
      if (chatStore.getActiveThreadId()) {
        await chatStore.clearActiveThread()
      }
    }
  },
  { immediate: true }
)

// 添加标题更新逻辑
const updateTitle = () => {
  const activeThread = chatStore.activeThread
  if (activeThread) {
    title.value = activeThread.title
  } else {
    title.value = 'New Chat'
  }
}

// 监听活动会话变化
watch(
  () => chatStore.activeThread,
  () => {
    updateTitle()
  },
  { immediate: true }
)

// 监听会话标题变化
watch(
  () => chatStore.threads,
  () => {
    if (chatStore.activeThread) {
      updateTitle()
    }
  },
  { deep: true }
)

// 点击外部区域关闭侧边栏
const isLargeScreen = useMediaQuery('(min-width: 1024px)')
let pendingScrollRetryTimer: number | null = null
let pendingScrollRetryCount = 0
let lastPendingScrollKey = ''
let pendingVariantResetKey = ''
const MAX_PENDING_SCROLL_RETRY = 12

/**
 * 处理滚动到指定消息
 */
const handleScrollToMessage = (messageId: string) => {
  if (chatViewRef.value && chatViewRef.value.messageList) {
    chatViewRef.value.messageList.scrollToMessage(messageId)

    // 在小屏幕模式下，滚动完成后延迟关闭导航
    if (!isLargeScreen.value && chatStore.isMessageNavigationOpen) {
      chatStore.isMessageNavigationOpen = false
    }
  }
}

const tryScrollToPendingMessage = () => {
  const activeThreadId = chatStore.activeThread?.id
  const pendingTarget = chatStore.activePendingScrollTarget
  if (!activeThreadId || !pendingTarget) {
    if (pendingScrollRetryTimer) {
      clearTimeout(pendingScrollRetryTimer)
      pendingScrollRetryTimer = null
    }
    pendingScrollRetryCount = 0
    lastPendingScrollKey = ''
    pendingVariantResetKey = ''
    return
  }

  const pendingKey = `${activeThreadId}:${pendingTarget.childConversationId ?? ''}:${pendingTarget.messageId ?? ''}`
  if (pendingKey !== lastPendingScrollKey) {
    pendingScrollRetryCount = 0
    lastPendingScrollKey = pendingKey
    pendingVariantResetKey = ''
    if (pendingScrollRetryTimer) {
      clearTimeout(pendingScrollRetryTimer)
      pendingScrollRetryTimer = null
    }
  }

  nextTick(() => {
    if (pendingTarget.childConversationId && chatViewRef.value?.messageList) {
      const scrolled = chatViewRef.value.messageList.scrollToSelectionHighlight?.(
        pendingTarget.childConversationId
      )
      if (scrolled) {
        chatStore.consumePendingScrollMessage(activeThreadId)
        pendingScrollRetryCount = 0
        lastPendingScrollKey = ''
        pendingVariantResetKey = ''
        if (pendingScrollRetryTimer) {
          clearTimeout(pendingScrollRetryTimer)
          pendingScrollRetryTimer = null
        }
        return
      }
      if (
        pendingTarget.messageId &&
        pendingVariantResetKey !== pendingKey &&
        chatStore.clearSelectedVariantForMessage(pendingTarget.messageId)
      ) {
        pendingVariantResetKey = pendingKey
        pendingScrollRetryCount = 0
        if (!pendingScrollRetryTimer) {
          pendingScrollRetryTimer = window.setTimeout(() => {
            pendingScrollRetryTimer = null
            tryScrollToPendingMessage()
          }, 60)
        }
        return
      }
      if (pendingScrollRetryCount >= MAX_PENDING_SCROLL_RETRY) {
        chatStore.consumePendingScrollMessage(activeThreadId)
        pendingScrollRetryCount = 0
        lastPendingScrollKey = ''
        pendingVariantResetKey = ''
        return
      }
      if (pendingScrollRetryCount >= 8 && pendingTarget.messageId) {
        const hasMessage = chatStore.getMessageIds().includes(pendingTarget.messageId)
        if (hasMessage) {
          handleScrollToMessage(pendingTarget.messageId)
          chatStore.consumePendingScrollMessage(activeThreadId)
          pendingScrollRetryCount = 0
          lastPendingScrollKey = ''
          pendingVariantResetKey = ''
          return
        }
      }
      if (!pendingScrollRetryTimer) {
        pendingScrollRetryCount += 1
        pendingScrollRetryTimer = window.setTimeout(() => {
          pendingScrollRetryTimer = null
          tryScrollToPendingMessage()
        }, 60)
      }
      return
    }

    if (!pendingTarget.childConversationId && pendingTarget.messageId) {
      const hasMessage = chatStore.getMessageIds().includes(pendingTarget.messageId)
      if (!hasMessage) return
      handleScrollToMessage(pendingTarget.messageId)
      chatStore.consumePendingScrollMessage(activeThreadId)
      pendingScrollRetryCount = 0
      lastPendingScrollKey = ''
    }
  })
}

watch(
  () =>
    [
      chatStore.activeThread?.id,
      chatStore.activePendingScrollTarget,
      chatStore.messageCount,
      chatStore.childThreadsByMessageId
    ] as const,
  () => {
    tryScrollToPendingMessage()
  },
  { immediate: true }
)

watch(
  () => chatStore.isMessageNavigationOpen,
  (isOpen) => {
    if (isOpen) {
      void chatStore.prefetchAllMessages()
    }
  }
)
</script>

<style>
.bg-grid-pattern {
  background-image:
    linear-gradient(to right, #000 1px, transparent 1px),
    linear-gradient(to bottom, #000 1px, transparent 1px);
  background-size: 20px 20px;
}

/* 添加全局样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #d1d5db80;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9ca3af80;
}
</style>
