<template>
  <div class="w-full h-full flex-row flex">
    <div
      :class="[
        'flex-1 w-0 h-full transition-all duration-200 max-lg:mr-0!',
        artifactStore.isOpen && route.name === 'chat' ? 'mr-[calc(60%-104px)]' : '',
        chatStore.isMessageNavigationOpen && !artifactStore.isOpen && isLargeScreen ? 'mr-80' : ''
      ]"
    >
      <div class="flex h-full">
        <!-- 主聊天区域 -->
        <div class="flex-1 flex flex-col w-0">
          <!-- 新会话 -->
          <NewThread v-if="!chatStore.getActiveThreadId()" />
          <template v-else>
            <!-- 标题栏 -->
            <!-- <TitleView @messageNavigationToggle="handleMessageNavigationToggle" /> -->

            <!-- 聊天内容区域 -->
            <ChatView ref="chatViewRef" />
          </template>
        </div>
      </div>
    </div>

    <!-- 消息导航侧边栏 (大屏幕) -->
    <div
      v-show="chatStore.isMessageNavigationOpen && !artifactStore.isOpen && isLargeScreen"
      class="fixed right-0 top-0 w-80 max-w-80 h-full z-10 hidden lg:block"
    >
      <MessageNavigationSidebar
        :messages="chatStore.variantAwareMessages"
        :is-open="chatStore.isMessageNavigationOpen"
        @close="chatStore.isMessageNavigationOpen = false"
        @scroll-to-message="handleScrollToMessage"
      />
    </div>

    <!-- 小屏幕模式下的消息导航侧边栏 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-300 ease-in"
        enter-from-class="translate-x-full opacity-0"
        leave-to-class="translate-x-full opacity-0"
      >
        <div v-if="chatStore.isMessageNavigationOpen" class="fixed inset-0 z-50 flex lg:hidden">
          <!-- 背景遮罩 -->
          <div class="flex-1" @click="chatStore.isMessageNavigationOpen = false"></div>

          <!-- 侧边栏 -->
          <div class="w-80 max-w-80">
            <MessageNavigationSidebar
              :messages="chatStore.variantAwareMessages"
              :is-open="chatStore.isMessageNavigationOpen"
              @close="chatStore.isMessageNavigationOpen = false"
              @scroll-to-message="handleScrollToMessage"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Artifacts 预览区域 -->
    <ArtifactDialog />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useChatStore } from '@/stores/chat'
import { watch, ref } from 'vue'
import { useTitle, useMediaQuery } from '@vueuse/core'
import { useArtifactStore } from '@/stores/artifact'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
import MessageNavigationSidebar from '@/components/MessageNavigationSidebar.vue'
import { useRoute } from 'vue-router'
const ChatView = defineAsyncComponent(() => import('@/components/ChatView.vue'))
const NewThread = defineAsyncComponent(() => import('@/components/NewThread.vue'))
const artifactStore = useArtifactStore()
const route = useRoute()
const chatStore = useChatStore()
const title = useTitle()
const chatViewRef = ref()
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
