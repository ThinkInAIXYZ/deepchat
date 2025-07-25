<template>
  <div class="w-full h-full flex-row flex">
    <div
      :class="[
        'flex-1 w-0 h-full transition-all duration-200 max-lg:!mr-0',
        artifactStore.isOpen && route.name === 'chat' ? 'mr-[calc(60%_-_104px)]' : ''
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
            <TitleView :model="activeModel" />

            <!-- 聊天内容区域 -->
            <ChatView />
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
import { computed, watch, ref } from 'vue'
import { onClickOutside, useTitle, useMediaQuery } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settings'
import { RENDERER_MODEL_META } from '@shared/presenter'
import { useArtifactStore } from '@/stores/artifact'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
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
const isLargeScreen = useMediaQuery('(min-width: 1024px)')

onClickOutside(sidebarRef, () => {
  if (chatStore.isSidebarOpen && !isLargeScreen.value) {
    chatStore.isSidebarOpen = false
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
