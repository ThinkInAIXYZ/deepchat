<template>
  <!-- Two-column layout: Chat area | Right drawer (threads / artifacts) -->
  <div class="w-full h-full flex">
    <!-- Chat area (with message navigation on the right) -->
    <div class="flex-1 w-0 h-full transition-all duration-200">
      <div class="flex h-full">
        <!-- Main chat column -->
        <div class="flex-1 flex flex-col w-0">
          <!-- New thread -->
          <NewThread v-if="!chatStore.getActiveThreadId()" />
          <template v-else>
            <!-- Title bar -->
            <TitleView
              :model="activeModel"
              @messageNavigationToggle="handleMessageNavigationToggle"
            />

            <!-- Content: left messages+input, right message navigation -->
            <div class="flex flex-1 min-h-0">
              <ChatView ref="chatViewRef" class="flex-1 min-w-0" />
              <!-- Message navigation (inline on large screens) -->
              <div
                v-show="chatStore.isMessageNavigationOpen && isLargeScreen"
                class="hidden lg:block w-80 max-w-80 h-full border-l shrink-0"
                ref="messageNavigationRef"
              >
                <MessageNavigationSidebar
                  :messages="chatStore.getMessages()"
                  :is-open="chatStore.isMessageNavigationOpen"
                  @close="chatStore.isMessageNavigationOpen = false"
                  @scroll-to-message="handleScrollToMessage"
                />
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
    <!-- Right drawer area: threads list (fixed on extra large screens) -->
    <aside
      ref="sidebarRef"
      class="hidden xl:flex h-full w-60 max-w-60 shrink-0 border-l"
      v-show="chatStore.isSidebarOpen && !artifactStore.isOpen"
    >
      <ThreadsView class="flex-1" />
    </aside>
  </div>

  <!-- Small screens: message navigation drawer (original behavior) -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      leave-active-class="transition-all duration-300 ease-in"
      enter-from-class="translate-x-full opacity-0"
      leave-to-class="translate-x-full opacity-0"
    >
      <div v-if="chatStore.isMessageNavigationOpen" class="fixed inset-0 z-50 flex lg:hidden">
        <div class="flex-1" @click="chatStore.isMessageNavigationOpen = false"></div>
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

  <!-- Small/medium screens: threads list as right-side drawer -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      leave-active-class="transition-all duration-300 ease-in"
      enter-from-class="translate-x-full opacity-0"
      leave-to-class="translate-x-full opacity-0"
    >
      <div
        v-if="chatStore.isSidebarOpen && !isWideScreen"
        class="fixed inset-0 z-50 flex xl:hidden"
      >
        <!-- Backdrop -->
        <div class="flex-1" @click="chatStore.isSidebarOpen = false"></div>
        <!-- Right-side threads drawer -->
        <div ref="threadDrawerRef" class="w-60 max-w-60 h-full border-l bg-background">
          <ThreadsView class="h-full" />
        </div>
      </div>
    </Transition>
  </Teleport>
  <!-- Artifacts keep independent right-side overlay experience -->
  <ArtifactDialog />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useChatStore } from '@/stores/chat'
import { computed, watch, ref } from 'vue'
import { onClickOutside, useTitle, useMediaQuery, useFavicon } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settings'
import { RENDERER_MODEL_META } from '@shared/presenter'
import { useArtifactStore } from '@/stores/artifact'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
import MessageNavigationSidebar from '@/components/MessageNavigationSidebar.vue'
import { useRoute } from 'vue-router'
import { useLanguageStore } from '@/stores/language'
import { getFaviconIcon } from '@/composables/useModelIcons'
const ThreadsView = defineAsyncComponent(() => import('@/components/ThreadsView.vue'))
const TitleView = defineAsyncComponent(() => import('@/components/TitleView.vue'))
const ChatView = defineAsyncComponent(() => import('@/components/ChatView.vue'))
const NewThread = defineAsyncComponent(() => import('@/components/NewThread.vue'))
const artifactStore = useArtifactStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const chatStore = useChatStore()
const title = useTitle()
const favicon = useFavicon()
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

// 添加 favicon 更新逻辑
const updateFavicon = () => {
  try {
    const activeThread = chatStore.activeThread
    const providerId = activeThread?.settings.providerId
    console.log('Setting favicon for provider:', providerId)

    const newFaviconUrl = getFaviconIcon(providerId)
    // 避免重复设置相同的favicon
    if (favicon.value !== newFaviconUrl) {
      favicon.value = newFaviconUrl
    }
  } catch (error) {
    console.warn('Error updating favicon:', error)
    // 出错时使用默认图标
    favicon.value = getFaviconIcon()
  }
}

// 监听活动会话变化
watch(
  () => chatStore.activeThread,
  (newThread, oldThread) => {
    updateTitle()
    // 只有当 providerId 真正变化时才更新 favicon
    if (newThread?.settings.providerId !== oldThread?.settings.providerId) {
      updateFavicon()
    }
  },
  { immediate: true }
)

// 监听会话标题变化
watch(
  () => chatStore.threads,
  () => {
    if (chatStore.activeThread) {
      updateTitle()
      // 标题变化时通常不需要更新favicon，除非是设置变更
      // updateFavicon()
    }
  },
  { deep: true }
)

// 点击外部区域关闭侧边栏
const sidebarRef = ref<HTMLElement>()
const messageNavigationRef = ref<HTMLElement>()
const threadDrawerRef = ref<HTMLElement>()
const isLargeScreen = useMediaQuery('(min-width: 1024px)')
const isWideScreen = useMediaQuery('(min-width: 1280px)')

onClickOutside(threadDrawerRef, () => {
  if (chatStore.isSidebarOpen && !isWideScreen.value) {
    chatStore.isSidebarOpen = false
  }
})

onClickOutside(sidebarRef, (event) => {
  const isClickInMessageNavigation = messageNavigationRef.value?.contains(event.target as Node)
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
