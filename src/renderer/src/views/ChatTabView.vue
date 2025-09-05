<template>
  <div class="w-full h-full flex-row flex">
    <div
      :class="[
        'flex-1 w-0 h-full transition-all duration-200 max-lg:!mr-0',
        artifactStore.isOpen && route.name === 'chat' ? 'mr-[calc(60%_-_104px)]' : '',
        chatStore.isMessageNavigationOpen && !artifactStore.isOpen && isLargeScreen ? 'mr-80' : ''
      ]"
    >
      <div class="flex h-full">
        <!-- 会话列表 (根据语言方向自适应位置) -->
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          leave-active-class="transition-all duration-300 ease-in"
          :enter-from-class="
            langStore.dir === 'rtl' ? 'translate-x-full opacity-0' : '-translate-x-full opacity-0'
          "
          :leave-to-class="
            langStore.dir === 'rtl' ? 'translate-x-full opacity-0' : '-translate-x-full opacity-0'
          "
        >
          <div
            v-show="chatStore.isSidebarOpen"
            ref="sidebarRef"
            :class="[
              'w-60 max-w-60 h-full fixed z-20 lg:relative',
              langStore.dir === 'rtl' ? 'right-0' : 'left-0'
            ]"
            :dir="langStore.dir"
          >
            <ThreadsView class="transform" />
          </div>
        </Transition>

        <!-- 主聊天区域 -->
        <div class="flex-1 flex flex-col w-0">
          <!-- 新会话 -->
          <NewThread v-if="!chatStore.getActiveThreadId()" />
          <template v-else>
            <!-- 标题栏 -->
            <TitleView
              :model="activeModel"
              @messageNavigationToggle="handleMessageNavigationToggle"
            />

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
        :messages="chatStore.getMessages()"
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
          <div ref="messageNavigationRef" class="w-80 max-w-80">
            <MessageNavigationSidebar
              :messages="chatStore.getMessages()"
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
import { computed, watch, ref } from 'vue'
import { onClickOutside, useTitle, useMediaQuery } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settings'
import { RENDERER_MODEL_META } from '@shared/presenter'
import { useArtifactStore } from '@/stores/artifact'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
import MessageNavigationSidebar from '@/components/MessageNavigationSidebar.vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '@/stores/language'
const ThreadsView = defineAsyncComponent(() => import('@/components/ThreadsView.vue'))
const TitleView = defineAsyncComponent(() => import('@/components/TitleView.vue'))
const ChatView = defineAsyncComponent(() => import('@/components/ChatView.vue'))
const NewThread = defineAsyncComponent(() => import('@/components/NewThread.vue'))
const artifactStore = useArtifactStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const chatStore = useChatStore()
const title = useTitle()
const langStore = useLanguageStore()
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
const sidebarRef = ref<HTMLElement>()
const messageNavigationRef = ref<HTMLElement>()
const isLargeScreen = useMediaQuery('(min-width: 1024px)')

onClickOutside(sidebarRef, (event) => {
  const isClickInMessageNavigation = messageNavigationRef.value?.contains(event.target as Node)

  if (chatStore.isSidebarOpen && !isLargeScreen.value) {
    chatStore.isSidebarOpen = false
  }
  if (chatStore.isMessageNavigationOpen && !isLargeScreen.value && !isClickInMessageNavigation) {
    chatStore.isMessageNavigationOpen = false
  }
})

const activeModel = computed(() => {
  let model: RENDERER_MODEL_META | undefined
  const modelId = chatStore.activeThread?.settings.modelId
  const providerId = chatStore.activeThread?.settings.providerId

  if (modelId && providerId) {
    // 首先在启用的模型中查找，同时匹配 modelId 和 providerId
    for (const group of settingsStore.enabledModels) {
      if (group.providerId === providerId) {
        const foundModel = group.models.find((m) => m.id === modelId)
        if (foundModel) {
          model = foundModel
          break
        }
      }
    }

    // 如果在启用的模型中没找到，再在自定义模型中查找
    if (!model) {
      for (const group of settingsStore.customModels) {
        if (group.providerId === providerId) {
          const foundModel = group.models.find((m) => m.id === modelId)
          if (foundModel) {
            model = foundModel
            break
          }
        }
      }
    }
  }

  if (!model) {
    model = {
      name: chatStore.activeThread?.settings.modelId || '',
      id: chatStore.activeThread?.settings.modelId || '',
      group: '',
      providerId: chatStore.activeThread?.settings.providerId || '',
      enabled: false,
      isCustom: false,
      contextLength: 0,
      maxTokens: 0
    }
  }
  return {
    name: model.name,
    id: model.id,
    providerId: model.providerId,
    tags: []
  }
})

const handleMessageNavigationToggle = () => {
  if (artifactStore.isOpen) {
    artifactStore.isOpen = false
    chatStore.isMessageNavigationOpen = true
  } else {
    chatStore.isMessageNavigationOpen = !chatStore.isMessageNavigationOpen
  }
}

/**
 * 处理滚动到指定消息
 */
const handleScrollToMessage = (messageId: string) => {
  if (chatViewRef.value && chatViewRef.value.messageList) {
    chatViewRef.value.messageList.scrollToMessage(messageId)

    // 在小屏幕模式下，滚动完成后延迟关闭导航
    if (!isLargeScreen.value && chatStore.isMessageNavigationOpen) {
      setTimeout(() => {
        chatStore.isMessageNavigationOpen = false
      }, 1000) // 延迟1秒关闭，让用户看到滚动效果
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
