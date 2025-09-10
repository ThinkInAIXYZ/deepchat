<template>
  <div class="h-full w-full flex flex-col items-center justify-start">
    <div class="w-full p-2 flex flex-row gap-2 items-center justify-end">
      <Button
        class="w-7 h-7 rounded-md"
        size="icon"
        variant="outline"
        @click="onSidebarButtonClick"
      >
        <Icon v-if="chatStore.isSidebarOpen" icon="lucide:panel-right-close" class="w-4 h-4" />
        <Icon v-else icon="lucide:panel-right-open" class="w-4 h-4" />
      </Button>
    </div>
    <div class="h-0 w-full flex-grow flex flex-col items-center justify-center">
      <img src="@/assets/logo-dark.png" class="w-24 h-24" loading="lazy" />
      <h1 class="text-2xl font-bold px-8 pt-4">{{ t('newThread.greeting') }}</h1>
      <h3 class="text-lg px-8 pb-2">{{ t('newThread.prompt') }}</h3>
      <div class="h-12"></div>
      <PromptInput
        ref="chatInputRef"
        key="newThread"
        class="!max-w-2xl flex-shrink-0 px-4"
        :rows="3"
        :max-rows="10"
        :context-length="contextLength"
        @send="handleSend"
      />
      <div class="h-12"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PromptInput from '@/components/uikit/chat/PromptInput.vue'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import { useChatStore } from '@/stores/chat'
import { MODEL_META } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'
import { nextTick, ref, watch, onMounted } from 'vue'
import { UserMessageContent } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import { ModelType } from '@shared/model'

const configPresenter = usePresenter('configPresenter')
// 定义偏好模型的类型
interface PreferredModel {
  modelId: string
  providerId: string
}

const { t } = useI18n()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const activeModel = ref({
  name: '',
  id: '',
  providerId: '',
  tags: [],
  type: ModelType.Chat
} as {
  name: string
  id: string
  providerId: string
  tags: string[]
  type: ModelType
})

const temperature = ref(0.6)
const contextLength = ref(16384)
const contextLengthLimit = ref(16384)
const maxTokens = ref(4096)
const maxTokensLimit = ref(4096)
const systemPrompt = ref('')
const artifacts = ref(settingsStore.artifactsEffectEnabled ? 1 : 0)
const thinkingBudget = ref<number | undefined>(undefined)
const enableSearch = ref<boolean | undefined>(undefined)
const forcedSearch = ref<boolean | undefined>(undefined)
const searchStrategy = ref<'turbo' | 'max' | undefined>(undefined)
const reasoningEffort = ref<'minimal' | 'low' | 'medium' | 'high' | undefined>(undefined)
const verbosity = ref<'low' | 'medium' | 'high' | undefined>(undefined)

// derived name no longer used in template

watch(
  () => activeModel.value,
  async () => {
    // console.log('activeModel', activeModel.value)
    const config = await configPresenter.getModelDefaultConfig(
      activeModel.value.id,
      activeModel.value.providerId
    )
    temperature.value = config.temperature ?? 0.7
    contextLength.value = config.contextLength
    maxTokens.value = config.maxTokens
    contextLengthLimit.value = config.contextLength
    maxTokensLimit.value = config.maxTokens
    thinkingBudget.value = config.thinkingBudget
    enableSearch.value = config.enableSearch
    forcedSearch.value = config.forcedSearch
    searchStrategy.value = config.searchStrategy
    reasoningEffort.value = config.reasoningEffort
    verbosity.value = config.verbosity
    // console.log('temperature', temperature.value)
    // console.log('contextLength', contextLength.value)
    // console.log('maxTokens', maxTokens.value)
  }
)
watch(
  () => [settingsStore.enabledModels, chatStore.threads],
  async () => {
    // 如果有现有线程，使用最近线程的模型
    if (chatStore.threads.length > 0) {
      if (chatStore.threads[0].dtThreads.length > 0) {
        const thread = chatStore.threads[0].dtThreads[0]
        const modelId = thread.settings.modelId
        const providerId = thread.settings.providerId

        // 同时匹配 modelId 和 providerId
        if (modelId && providerId) {
          for (const provider of settingsStore.enabledModels) {
            if (provider.providerId === providerId) {
              for (const model of provider.models) {
                if (model.id === modelId) {
                  activeModel.value = {
                    name: model.name,
                    id: model.id,
                    providerId: provider.providerId,
                    tags: [],
                    type: model.type ?? ModelType.Chat
                  }
                  return
                }
              }
            }
          }
        }
      }
    }

    // 如果没有现有线程，尝试使用用户上次选择的模型
    try {
      const preferredModel = (await configPresenter.getSetting('preferredModel')) as
        | PreferredModel
        | undefined
      if (preferredModel && preferredModel.modelId && preferredModel.providerId) {
        // 验证偏好模型是否还在可用模型列表中
        for (const provider of settingsStore.enabledModels) {
          if (provider.providerId === preferredModel.providerId) {
            for (const model of provider.models) {
              if (model.id === preferredModel.modelId) {
                activeModel.value = {
                  name: model.name,
                  id: model.id,
                  providerId: provider.providerId,
                  tags: [],
                  type: model.type ?? ModelType.Chat
                }
                return
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to get user preferred model:', error)
    }

    // 如果没有偏好模型或偏好模型不可用，使用第一个可用模型
    if (settingsStore.enabledModels.length > 0) {
      const model = settingsStore.enabledModels
        .flatMap((provider) =>
          provider.models.map((m) => ({ ...m, providerId: provider.providerId }))
        )
        .find((m) => m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
      if (model) {
        activeModel.value = {
          name: model.name,
          id: model.id,
          providerId: model.providerId,
          tags: [],
          type: model.type ?? ModelType.Chat
        }
      }
    }
  },
  { immediate: true, deep: true }
)

const chatInputRef = ref<InstanceType<typeof PromptInput> | null>(null)

const onSidebarButtonClick = () => {
  chatStore.isSidebarOpen = !chatStore.isSidebarOpen
}

const handleModelUpdate = (model: MODEL_META, providerId: string) => {
  activeModel.value = {
    name: model.name,
    id: model.id,
    providerId: providerId,
    tags: [],
    type: model.type ?? ModelType.Chat
  }
  chatStore.updateChatConfig({
    modelId: model.id,
    providerId: providerId
  })

  // 保存用户的模型偏好设置
  configPresenter.setSetting('preferredModel', {
    modelId: model.id,
    providerId: providerId
  })
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
      if (newCache.msg || newCache.mentions) {
        const setInputContent = () => {
          if (chatInputRef.value) {
            console.log('[NewThread] Setting input content, msg:', newCache.msg)
            const chatInput = chatInputRef.value
            chatInput.clearContent()
            if (newCache.mentions) {
              newCache.mentions.forEach((mention) => {
                chatInput.appendMention(mention)
              })
            }
            if (newCache.msg) {
              console.log('[NewThread] Appending text:', newCache.msg)
              chatInput.appendText(newCache.msg)
            }
            return true
          }
          return false
        }

        if (!setInputContent()) {
          console.log('[NewThread] ChatInput ref not ready, retrying...')
          nextTick(() => {
            if (!setInputContent()) {
              setTimeout(() => {
                if (!setInputContent()) {
                  console.warn('[NewThread] Failed to set input content after retries')
                }
              }, 100)
            }
          })
        }
      }
      if (newCache.systemPrompt) {
        systemPrompt.value = newCache.systemPrompt
      }
      if (newCache.autoSend && newCache.msg) {
        handleSend({
          text: newCache.msg || '',
          files: [],
          links: [],
          think: false,
          search: false
        })
      }
      // 清理缓存
      chatStore.clearDeeplinkCache()
    }
  },
  { immediate: true }
)

onMounted(async () => {
  configPresenter.getDefaultSystemPrompt().then((prompt) => {
    systemPrompt.value = prompt
  })
})

const handleSend = async (content: UserMessageContent) => {
  const threadId = await chatStore.createThread(content.text, {
    providerId: activeModel.value.providerId,
    modelId: activeModel.value.id,
    systemPrompt: systemPrompt.value,
    temperature: temperature.value,
    contextLength: contextLength.value,
    maxTokens: maxTokens.value,
    artifacts: artifacts.value as 0 | 1,
    thinkingBudget: thinkingBudget.value,
    enableSearch: enableSearch.value,
    forcedSearch: forcedSearch.value,
    searchStrategy: searchStrategy.value,
    reasoningEffort: reasoningEffort.value,
    verbosity: verbosity.value,
    enabledMcpTools: chatStore.chatConfig.enabledMcpTools
  } as any)
  console.log('threadId', threadId, activeModel.value)
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
