<template>
  <div class="h-full w-full flex flex-col items-center justify-start">
    <div class="w-full p-2 flex flex-row gap-2 items-center">
      <Button
        class="w-7 h-7 rounded-md hover:bg-accent"
        size="icon"
        variant="outline"
        @click="onSidebarButtonClick"
      >
        <Icon
          v-if="chatStore.isSidebarOpen"
          icon="lucide:panel-left-close"
          class="w-4 h-4 text-muted-foreground"
        />
        <Icon v-else icon="lucide:panel-left-open" class="w-4 h-4 text-muted-foreground" />
      </Button>
    </div>
    <div class="h-0 w-full flex-grow flex flex-col items-center justify-center">
      <img src="@/assets/logo-dark.png" class="w-24 h-24" />
      <h1 class="text-2xl font-bold px-8 pt-4">{{ t('newThread.greeting') }}</h1>
      <h3 class="text-lg text-muted-foreground px-8 pb-2">{{ t('newThread.prompt') }}</h3>
      <div class="h-12"></div>
      <ChatInput
        ref="chatInputRef"
        key="newThread"
        class="!max-w-2xl flex-shrink-0 px-4"
        :rows="3"
        :max-rows="10"
        :context-length="contextLength"
        @send="handleSend"
      >
        <template #addon-buttons>
          <span
            key="newThread-model-select"
            class="new-thread-model-select overflow-hidden flex items-center h-7 rounded-lg shadow-sm border border-border transition-all duration-300"
          >
            <Popover v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="flex border-none rounded-none shadow-none items-center gap-1.5 px-2 h-full"
                  size="sm"
                >
                  <ModelIcon class="w-4 h-4" :model-id="activeModel.id"></ModelIcon>
                  <!-- <Icon icon="lucide:message-circle" class="w-5 h-5 text-muted-foreground" /> -->
                  <h2 class="text-xs font-bold max-w-[150px] truncate">{{ name }}</h2>
                  <Badge
                    v-for="tag in activeModel.tags"
                    :key="tag"
                    variant="outline"
                    class="py-0 rounded-lg"
                    size="xs"
                    >{{ t(`model.tags.${tag}`) }}</Badge
                  >
                  <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="p-0 w-80">
                <ModelSelect @update:model="handleModelUpdate" />
              </PopoverContent>
            </Popover>
            <Popover v-model:open="settingsPopoverOpen" @update:open="handleSettingsPopoverUpdate">
              <PopoverTrigger as-child>
                <Button
                  class="w-7 h-full rounded-none border-none shadow-none hover:bg-accent text-muted-foreground dark:hover:text-primary-foreground transition-all duration-300"
                  :class="{
                    'w-0 opacity-0 p-0 overflow-hidden': !showSettingsButton && !isHovering,
                    'w-7 opacity-100': showSettingsButton || isHovering
                  }"
                  size="icon"
                  variant="outline"
                >
                  <Icon icon="lucide:settings-2" class="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="p-0 w-80">
                <ChatConfig
                  v-model:temperature="temperature"
                  v-model:context-length="contextLength"
                  v-model:max-tokens="maxTokens"
                  v-model:system-prompt="systemPrompt"
                  v-model:artifacts="artifacts"
                  :context-length-limit="contextLengthLimit"
                  :max-tokens-limit="maxTokensLimit"
                />
              </PopoverContent>
            </Popover>
          </span>
        </template>
      </ChatInput>
      <div class="h-12"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ChatInput from './ChatInput.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import ModelIcon from './icons/ModelIcon.vue'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@iconify/vue'
import ModelSelect from './ModelSelect.vue'
import { useChatStore } from '@/stores/chat'
import { MODEL_META } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'
import { computed, ref, watch, onMounted } from 'vue'
import { UserMessageContent } from '@shared/chat'
import ChatConfig from './ChatConfig.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useEventListener } from '@vueuse/core'
const configPresenter = usePresenter('configPresenter')
const { t } = useI18n()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const activeModel = ref({
  name: '',
  id: '',
  providerId: '',
  tags: []
} as {
  name: string
  id: string
  providerId: string
  tags: string[]
})

const temperature = ref(0.6)
const contextLength = ref(16384)
const contextLengthLimit = ref(16384)
const maxTokens = ref(4096)
const maxTokensLimit = ref(4096)
const systemPrompt = ref('')
const artifacts = ref(settingsStore.artifactsEffectEnabled ? 1 : 0)

const name = computed(() => {
  return activeModel.value?.name ? activeModel.value.name.split('/').pop() : ''
})

watch(
  () => activeModel.value,
  async () => {
    // console.log('activeModel', activeModel.value)
    const config = await configPresenter.getModelDefaultConfig(activeModel.value.id)
    temperature.value = config.temperature
    contextLength.value = config.contextLength
    maxTokens.value = config.maxTokens
    contextLengthLimit.value = config.contextLength
    maxTokensLimit.value = config.maxTokens
    // console.log('temperature', temperature.value)
    // console.log('contextLength', contextLength.value)
    // console.log('maxTokens', maxTokens.value)
  }
)
watch(
  () => [settingsStore.enabledModels, chatStore.threads],
  () => {
    if (chatStore.threads.length > 0) {
      if (chatStore.threads[0].dtThreads.length > 0) {
        const thread = chatStore.threads[0].dtThreads[0]
        const modelId = thread.settings.modelId
        for (const provider of settingsStore.enabledModels) {
          for (const model of provider.models) {
            if (model.id === modelId) {
              activeModel.value = {
                name: model.name,
                id: model.id,
                providerId: provider.providerId,
                tags: []
              }
              return
            }
          }
        }
      }
    }
    // console.log(settingsStore.enabledModels.length)
    if (settingsStore.enabledModels.length > 0) {
      const model = settingsStore.enabledModels[0].models[0]
      if (model) {
        activeModel.value = {
          name: model.name,
          id: model.id,
          providerId: settingsStore.enabledModels[0].providerId,
          tags: []
        }
      }
    }
  },
  { immediate: true, deep: true }
)

const modelSelectOpen = ref(false)
const settingsPopoverOpen = ref(false)
const showSettingsButton = ref(false)
const isHovering = ref(false)
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)
// 监听鼠标悬停
const handleMouseEnter = () => {
  isHovering.value = true
}

const handleMouseLeave = () => {
  isHovering.value = false
}

const onSidebarButtonClick = () => {
  chatStore.isSidebarOpen = !chatStore.isSidebarOpen
}

const handleModelUpdate = (model: MODEL_META, providerId: string) => {
  activeModel.value = {
    name: model.name,
    id: model.id,
    providerId: providerId,
    tags: []
  }
  
  chatStore.updateChatConfig({
    modelId: model.id,
    providerId: providerId
  })
  modelSelectOpen.value = false
}

// 监听 deeplinkCache 变化
watch(
  () => chatStore.deeplinkCache,
  (newCache) => {
    if (newCache) {
      if (newCache.modelId) {
        const matchedModel = settingsStore.findModelByIdOrName(newCache.modelId)
        console.log('matchedModel', matchedModel)
        if (matchedModel) {
          handleModelUpdate(matchedModel.model, matchedModel.providerId)
        }
      }
      if (newCache.msg && chatInputRef.value) {
        chatInputRef.value.setText(newCache.msg)
      }
      if (newCache.systemPrompt) {
        systemPrompt.value = newCache.systemPrompt
      }
      // 清理缓存
      chatStore.clearDeeplinkCache()
    }
  },
  { immediate: true }
)

onMounted(() => {
  const groupElement = document.querySelector('.new-thread-model-select')
  if (groupElement) {
    useEventListener(groupElement, 'mouseenter', handleMouseEnter)
    useEventListener(groupElement, 'mouseleave', handleMouseLeave)
  }
})

const handleSettingsPopoverUpdate = (isOpen: boolean) => {
  if (isOpen) {
    // 如果打开，立即显示按钮
    showSettingsButton.value = true
  } else {
    // 如果关闭，延迟隐藏按钮，等待动画完成
    setTimeout(() => {
      showSettingsButton.value = false
    }, 300) // 300ms是一个常见的动画持续时间，可以根据实际情况调整
  }
}

// 初始化时设置showSettingsButton的值与settingsPopoverOpen一致
watch(
  settingsPopoverOpen,
  (value) => {
    if (value) {
      showSettingsButton.value = true
    }
  },
  { immediate: true }
)

const handleSend = async (content: UserMessageContent) => {
  const threadId = await chatStore.createThread(content.text, {
    providerId: activeModel.value.providerId,
    modelId: activeModel.value.id,
    systemPrompt: systemPrompt.value,
    temperature: temperature.value,
    contextLength: contextLength.value,
    maxTokens: maxTokens.value,
    artifacts: artifacts.value as 0 | 1
  })
  console.log('threadId', threadId, activeModel.value)
  await chatStore.setActiveThread(threadId)
  chatStore.sendMessage(content)
}
</script>

<style scoped>
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.duration-300 {
  transition-duration: 300ms;
}
</style>
