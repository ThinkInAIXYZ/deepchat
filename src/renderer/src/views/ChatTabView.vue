<template>
  <div class="w-full h-full flex-row flex">
    <div :class="['flex-1 w-0 h-full transition-all duration-200 max-lg:mr-0!', chatViewMargin]">
      <div class="flex h-full">
        <!-- 主聊天区域 -->
        <div class="flex-1 flex flex-col w-0">
          <!-- Mock welcome page -->
          <MockWelcomePage v-if="showMockWelcome" />
          <!-- Mock chat page -->
          <MockChatPage
            v-else-if="isMockChatActive"
            :title="mockSessionTitle"
            :project="mockSessionProject"
          />
          <!-- 新会话 -->
          <NewThread v-else-if="!chatStore.getActiveThreadId()" />
          <template v-else>
            <!-- 标题栏 -->
            <!-- <TitleView @messageNavigationToggle="handleMessageNavigationToggle" /> -->

            <!-- 聊天内容区域 -->
            <ChatView ref="chatViewRef" />
          </template>
        </div>
      </div>
    </div>

    <!-- Artifacts 预览区域 -->
    <ArtifactDialog />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useMockViewState } from '@/composables/useMockViewState'
import { watch, ref, computed, nextTick } from 'vue'
import { useTitle, useMediaQuery } from '@vueuse/core'
import { useArtifactStore } from '@/stores/artifact'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
import { useRoute } from 'vue-router'
const ChatView = defineAsyncComponent(() => import('@/components/ChatView.vue'))
const NewThread = defineAsyncComponent(() => import('@/components/NewThread.vue'))
const MockChatPage = defineAsyncComponent(() => import('@/components/mock/MockChatPage.vue'))
const MockWelcomePage = defineAsyncComponent(() => import('@/components/mock/MockWelcomePage.vue'))
const { isMockChatActive, mockSessionTitle, mockSessionProject, showMockWelcome } =
  useMockViewState()
const artifactStore = useArtifactStore()
const route = useRoute()
const chatStore = useChatStore()
const title = useTitle()
const chatViewRef = ref()

// Calculate chat view margin based on artifact and workspace state
const chatViewMargin = computed(() => {
  if (route.name !== 'chat') return ''

  const artifactOpen = artifactStore.isOpen
  if (artifactOpen) {
    // Only artifact open
    return 'mr-[calc(60%-104px)]'
  }
  return ''
})
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
