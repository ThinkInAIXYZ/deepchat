<template>
  <div class="h-full w-full flex flex-col items-center justify-start">
    <div class="h-0 w-full grow flex flex-col items-center justify-center">
      <img src="@/assets/logo-dark.png" class="w-24 h-24" loading="lazy" />
      <h1 class="text-2xl font-bold px-8 pt-4">{{ t('newThread.greeting') }}</h1>
      <h3 class="text-lg px-8 pb-2">{{ t('newThread.prompt') }}</h3>
      <div class="h-12"></div>
      <ChatInput
        ref="chatInputRef"
        key="newThread"
        variant="newThread"
        class="shrink-0 px-4"
        :rows="3"
        :max-rows="10"
        :context-length="contextLength"
        @send="handleSend"
      >
        <template #addon-buttons>
          <div
            key="newThread-model-select"
            class="new-thread-model-select overflow-hidden flex items-center h-7 rounded-lg shadow-sm border border-input transition-all duration-300"
            :dir="langStore.dir"
          >
            <Popover v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="flex border-none rounded-none shadow-none items-center gap-1.5 px-2 h-full"
                  size="sm"
                >
                  <ModelIcon
                    class="w-4 h-4"
                    :model-id="activeModel.providerId"
                    :is-dark="themeStore.isDark"
                  ></ModelIcon>
                  <!-- <Icon icon="lucide:message-circle" class="w-5 h-5 text-muted-foreground" /> -->
                  <h2 class="text-xs font-bold max-w-[150px] truncate">{{ name }}</h2>
                  <Badge
                    v-for="tag in activeModel.tags"
                    :key="tag"
                    variant="outline"
                    class="py-0 rounded-lg"
                    size="sm"
                  >
                    {{ t(`model.tags.${tag}`) }}</Badge
                  >
                  <Icon icon="lucide:chevron-right" class="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="p-0 w-80">
                <ModelSelect
                  :type="[ModelType.Chat, ModelType.ImageGeneration]"
                  @update:model="handleModelUpdate"
                />
              </PopoverContent>
            </Popover>
            <ScrollablePopover
              v-model:open="settingsPopoverOpen"
              @update:open="handleSettingsPopoverUpdate"
              align="start"
              content-class="w-80"
              :enable-scrollable="true"
            >
              <template #trigger>
                <Button
                  class="w-7 h-full rounded-none border-none shadow-none transition-all duration-300"
                  :class="{
                    'w-0 opacity-0 p-0 overflow-hidden': !showSettingsButton && !isHovering,
                    'w-7 opacity-100': showSettingsButton || isHovering
                  }"
                  size="icon"
                  variant="outline"
                >
                  <Icon icon="lucide:settings-2" class="w-4 h-4" />
                </Button>
              </template>
              <ChatConfig
                v-model:temperature="temperature"
                v-model:context-length="contextLength"
                v-model:max-tokens="maxTokens"
                v-model:system-prompt="systemPrompt"
                v-model:artifacts="artifacts"
                v-model:thinking-budget="thinkingBudget"
                v-model:enable-search="enableSearch"
                v-model:forced-search="forcedSearch"
                v-model:search-strategy="searchStrategy"
                v-model:reasoning-effort="reasoningEffort"
                v-model:verbosity="verbosity"
                :context-length-limit="contextLengthLimit"
                :max-tokens-limit="maxTokensLimit"
                :model-id="activeModel?.id"
                :provider-id="activeModel?.providerId"
                :model-type="activeModel?.type"
              />
            </ScrollablePopover>
          </div>
        </template>
      </ChatInput>
      <div class="h-12"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ChatInput from './chat-input/ChatInput.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ScrollablePopover from './ScrollablePopover.vue'
import { Button } from '@shadcn/components/ui/button'
import ModelIcon from './icons/ModelIcon.vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Icon } from '@iconify/vue'
import ModelSelect from './ModelSelect.vue'
import { useChatStore } from '@/stores/chat'
import { MODEL_META } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'
import { computed, nextTick, ref, watch, onMounted } from 'vue'
import { UserMessageContent } from '@shared/chat'
import ChatConfig from './ChatConfig.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useEventListener } from '@vueuse/core'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { ModelType } from '@shared/model'

const configPresenter = usePresenter('configPresenter')
const themeStore = useThemeStore()
const langStore = useLanguageStore()
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

const name = computed(() => {
  return activeModel.value?.name ? activeModel.value.name.split('/').pop() : ''
})

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
// 初始化与校验逻辑：只在激活时初始化一次；仅监听 enabledModels 变化做有效性校验
const initialized = ref(false)

const findEnabledModel = (providerId: string, modelId: string) => {
  for (const provider of settingsStore.enabledModels) {
    if (provider.providerId === providerId) {
      for (const model of provider.models) {
        if (model.id === modelId) {
          return { model, providerId: provider.providerId }
        }
      }
    }
  }
  return undefined
}

const pickFirstEnabledModel = () => {
  const found = settingsStore.enabledModels
    .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
    .find((m) => m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
  return found
}

const setActiveFromEnabled = (m: {
  name: string
  id: string
  providerId: string
  type?: ModelType
}) => {
  activeModel.value = {
    name: m.name,
    id: m.id,
    providerId: m.providerId,
    tags: [],
    type: m.type ?? ModelType.Chat
  }
}

const initActiveModel = async () => {
  if (initialized.value) return
  // 1) 尝试根据最近会话（区分 pinned/非 pinned）选择
  if (chatStore.threads.length > 0) {
    const pinnedGroup = chatStore.threads.find((g) => g.dt === 'Pinned')
    const pinnedFirst = pinnedGroup?.dtThreads?.[0]
    const normalGroup = chatStore.threads.find((g) => g.dt !== 'Pinned' && g.dtThreads.length > 0)
    const normalFirst = normalGroup?.dtThreads?.[0]
    const candidate = [pinnedFirst, normalFirst]
      .filter(Boolean)
      .sort((a, b) => (b!.updatedAt || 0) - (a!.updatedAt || 0))[0] as
      | typeof pinnedFirst
      | undefined
    if (candidate?.settings?.modelId && candidate?.settings?.providerId) {
      const match = findEnabledModel(candidate.settings.providerId, candidate.settings.modelId)
      if (match) {
        setActiveFromEnabled({ ...match.model, providerId: match.providerId })
        initialized.value = true
        return
      }
    }
  }

  // 2) 尝试用户上次选择的偏好模型
  try {
    const preferredModel = (await configPresenter.getSetting('preferredModel')) as
      | PreferredModel
      | undefined
    if (preferredModel?.modelId && preferredModel?.providerId) {
      const match = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
      if (match) {
        setActiveFromEnabled({ ...match.model, providerId: match.providerId })
        initialized.value = true
        return
      }
    }
  } catch (error) {
    console.warn('Failed to get user preferred model:', error)
  }

  // 3) 选择第一个可用模型
  const first = pickFirstEnabledModel()
  if (first) {
    setActiveFromEnabled(first)
    initialized.value = true
  }
}

// 仅监听 enabledModels：
// - 若未初始化，进行一次初始化
// - 若已初始化但当前模型不再可用，则回退到第一个 enabled 模型
watch(
  () => settingsStore.enabledModels,
  async () => {
    if (!initialized.value) {
      await initActiveModel()
      return
    }

    // 校验当前模型是否仍可用
    const current = activeModel.value
    if (!current?.id || !current?.providerId) {
      const first = pickFirstEnabledModel()
      if (first) setActiveFromEnabled(first)
      return
    }
    const stillExists = !!findEnabledModel(current.providerId, current.id)
    if (!stillExists) {
      const first = pickFirstEnabledModel()
      if (first) setActiveFromEnabled(first)
    }
  },
  { immediate: false, deep: true }
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
  const groupElement = document.querySelector('.new-thread-model-select')
  configPresenter.getDefaultSystemPrompt().then((prompt) => {
    systemPrompt.value = prompt
  })
  // 组件激活时初始化一次默认模型
  await initActiveModel()
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
