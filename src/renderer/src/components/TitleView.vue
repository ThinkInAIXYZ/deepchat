<template>
  <div class="flex items-center justify-between w-full p-2">
    <div class="flex flex-row gap-2 items-center">
      <Button
        class="w-7 h-7 rounded-md"
        size="icon"
        variant="outline"
        @click="onSidebarButtonClick"
      >
        <Icon v-if="chatStore.isSidebarOpen" icon="lucide:panel-left-close" class="w-4 h-4" />
        <Icon v-else icon="lucide:panel-left-open" class="w-4 h-4" />
      </Button>
      <Popover v-model:open="modelSelectOpen">
        <PopoverTrigger as-child>
          <Button variant="outline" class="flex items-center gap-1.5 px-2 h-7 relative" size="sm">
            <ModelIcon :model-id="model.providerId" :is-dark="themeStore.isDark"></ModelIcon>
            <h2 class="text-xs font-bold">{{ model.name }}</h2>
            <Badge
              v-for="tag in model.tags"
              :key="tag"
              variant="outline"
              class="py-0 rounded-lg"
              size="xs"
              >{{ t(`model.tags.${tag}`) }}</Badge
            >
            <div
              v-if="rateLimitStatus?.config.enabled"
              class="flex items-center gap-1"
              :title="getRateLimitTooltip()"
            >
              <Icon :icon="getRateLimitIcon()" :class="getRateLimitIconClass()" class="w-3 h-3" />
            </div>
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
    </div>

    <div class="flex items-center gap-2">
      <!-- 消息导航按钮 -->
      <Button
        class="w-7 h-7 rounded-md relative !p-0"
        size="icon"
        variant="outline"
        :class="{ 'bg-accent': chatStore.isMessageNavigationOpen }"
        @click="onMessageNavigationButtonClick"
      >
        <Icon
          icon="lucide:list"
          class="w-4 h-4 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
        />
      </Button>

      <ScrollablePopover align="end" content-class="w-80" :enable-scrollable="true">
        <template #trigger>
          <Button class="w-7 h-7 rounded-md" size="icon" variant="outline">
            <Icon icon="lucide:settings-2" class="w-4 h-4" />
          </Button>
        </template>
        <ChatConfig
          v-model:system-prompt="systemPrompt"
          v-model:temperature="temperature"
          v-model:context-length="contextLength"
          v-model:max-tokens="maxTokens"
          v-model:artifacts="artifacts"
          v-model:thinking-budget="thinkingBudget"
          v-model:enable-search="enableSearch"
          v-model:forced-search="forcedSearch"
          v-model:search-strategy="searchStrategy"
          v-model:reasoning-effort="reasoningEffort"
          v-model:verbosity="verbosity"
          :context-length-limit="contextLengthLimit"
          :max-tokens-limit="maxTokensLimit"
          :model-id="chatStore.chatConfig.modelId"
          :provider-id="chatStore.chatConfig.providerId"
          :model-type="modelType"
          @update:temperature="updateTemperature"
          @update:context-length="updateContextLength"
          @update:max-tokens="updateMaxTokens"
          @update:artifacts="updateArtifacts"
          @update:thinking-budget="updateThinkingBudget"
          @update:enable-search="updateEnableSearch"
          @update:forced-search="updateForcedSearch"
          @update:search-strategy="updateSearchStrategy"
          @update:reasoning-effort="updateReasoningEffort"
          @update:verbosity="updateVerbosity"
        />
      </ScrollablePopover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import ScrollablePopover from './ScrollablePopover.vue'
import ChatConfig from './ChatConfig.vue'
import ModelSelect from './ModelSelect.vue'
import ModelIcon from './icons/ModelIcon.vue'
import { MODEL_META } from '@shared/presenter'
import { onMounted, onUnmounted, ref, watch, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { usePresenter } from '@/composables/usePresenter'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import { ModelType } from '@shared/model'
import { RATE_LIMIT_EVENTS } from '@/events'

const emit = defineEmits(['messageNavigationToggle'])

const configPresenter = usePresenter('configPresenter')
const llmPresenter = usePresenter('llmproviderPresenter')

const { t } = useI18n()
const chatStore = useChatStore()
const themeStore = useThemeStore()
const settingsStore = useSettingsStore()
// Chat configuration state
const temperature = ref(chatStore.chatConfig.temperature)
const contextLength = ref(chatStore.chatConfig.contextLength)
const maxTokens = ref(chatStore.chatConfig.maxTokens)
const systemPrompt = ref(chatStore.chatConfig.systemPrompt)
const artifacts = ref(chatStore.chatConfig.artifacts)
const thinkingBudget = ref(chatStore.chatConfig.thinkingBudget)
const enableSearch = ref(chatStore.chatConfig.enableSearch)
const forcedSearch = ref(chatStore.chatConfig.forcedSearch)
const searchStrategy = ref(chatStore.chatConfig.searchStrategy)

const reasoningEffort = ref(chatStore.chatConfig.reasoningEffort)
const verbosity = ref(chatStore.chatConfig.verbosity)
const modelType = ref(ModelType.Chat)
// 获取模型配置来初始化默认值并智能调整当前参数
const loadModelConfig = async () => {
  const modelId = chatStore.chatConfig.modelId
  const providerId = chatStore.chatConfig.providerId

  if (modelId && providerId) {
    try {
      const config = await configPresenter.getModelDefaultConfig(modelId, providerId)
      modelType.value = config.type

      contextLengthLimit.value = config.contextLength
      maxTokensLimit.value = config.maxTokens

      if (contextLength.value > config.contextLength) {
        contextLength.value = config.contextLength
      } else if (contextLength.value < 2048) {
        contextLength.value = Math.max(2048, config.contextLength)
      }

      const maxTokensMax = !config.maxTokens || config.maxTokens < 8192 ? 8192 : config.maxTokens
      if (maxTokens.value > maxTokensMax) {
        maxTokens.value = maxTokensMax
      } else if (maxTokens.value < 1024) {
        maxTokens.value = 1024
      }
      // reset to default temperature
      temperature.value = config.temperature ?? 0.6

      if (config.thinkingBudget !== undefined) {
        if (thinkingBudget.value === undefined) {
          thinkingBudget.value = config.thinkingBudget
        } else {
          if (thinkingBudget.value < -1) {
            thinkingBudget.value = -1
          } else if (thinkingBudget.value > 32768) {
            thinkingBudget.value = 32768
          }
        }
      } else {
        thinkingBudget.value = undefined
      }

      // 只在用户没有明确设置时才使用模型默认配置
      // 避免覆盖用户已有的配置选择
      if (config.enableSearch !== undefined && enableSearch.value === undefined) {
        enableSearch.value = config.enableSearch
      }

      if (config.forcedSearch !== undefined && forcedSearch.value === undefined) {
        forcedSearch.value = config.forcedSearch
      }

      if (config.searchStrategy !== undefined && searchStrategy.value === undefined) {
        searchStrategy.value = config.searchStrategy
      }

      if (config.reasoningEffort !== undefined) {
        if (reasoningEffort.value === undefined) {
          reasoningEffort.value = config.reasoningEffort
        }
      } else {
        reasoningEffort.value = undefined
      }

      if (config.verbosity !== undefined) {
        if (verbosity.value === undefined) {
          verbosity.value = config.verbosity
        }
      } else {
        verbosity.value = undefined
      }
    } catch (error) {
      console.error('Failed to load model config:', error)
    }
  }
}
const contextLengthLimit = ref(chatStore.chatConfig.contextLength)
const maxTokensLimit = ref(chatStore.chatConfig.maxTokens)

const rateLimitStatus = ref<{
  config: { enabled: boolean; qpsLimit: number }
  currentQps: number
  queueLength: number
  lastRequestTime: number
} | null>(null)

const canExecuteImmediately = computed(() => {
  if (!rateLimitStatus.value?.config.enabled) return true

  const now = Date.now()
  const intervalMs = (1 / rateLimitStatus.value.config.qpsLimit) * 1000
  const timeSinceLastRequest = now - rateLimitStatus.value.lastRequestTime

  return timeSinceLastRequest >= intervalMs
})

const getRateLimitIcon = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''

  if (rateLimitStatus.value.queueLength > 0) {
    return 'lucide:clock'
  }

  return canExecuteImmediately.value ? 'lucide:check-circle' : 'lucide:timer'
}

const getRateLimitIconClass = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''

  if (rateLimitStatus.value.queueLength > 0) {
    return 'text-orange-500 animate-pulse'
  }

  return canExecuteImmediately.value ? 'text-green-500' : 'text-yellow-500'
}

const getRateLimitTooltip = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''

  const intervalSeconds = 1 / rateLimitStatus.value.config.qpsLimit

  if (rateLimitStatus.value.queueLength > 0) {
    return t('chat.rateLimit.queueTooltip', {
      count: rateLimitStatus.value.queueLength,
      interval: intervalSeconds
    })
  }

  if (canExecuteImmediately.value) {
    return t('chat.rateLimit.readyTooltip', { interval: intervalSeconds })
  }

  const waitTime = Math.ceil(
    (rateLimitStatus.value.lastRequestTime + intervalSeconds * 1000 - Date.now()) / 1000
  )
  return t('chat.rateLimit.waitingTooltip', { seconds: waitTime, interval: intervalSeconds })
}

// Independent update functions
const updateTemperature = (value: number) => {
  temperature.value = value
}

const updateContextLength = (value: number) => {
  contextLength.value = value
}

const updateMaxTokens = (value: number) => {
  maxTokens.value = value
}

const updateArtifacts = (value: 0 | 1) => {
  artifacts.value = value
}

const updateThinkingBudget = (value: number | undefined) => {
  thinkingBudget.value = value
}

const updateEnableSearch = (value: boolean | undefined) => {
  enableSearch.value = value
}

const updateForcedSearch = (value: boolean | undefined) => {
  forcedSearch.value = value
}

const updateSearchStrategy = (value: 'turbo' | 'max' | undefined) => {
  searchStrategy.value = value
}

const updateReasoningEffort = (value: 'minimal' | 'low' | 'medium' | 'high') => {
  reasoningEffort.value = value
}

const updateVerbosity = (value: 'low' | 'medium' | 'high') => {
  verbosity.value = value
}

const onSidebarButtonClick = () => {
  chatStore.isSidebarOpen = !chatStore.isSidebarOpen
}

// 新增的事件处理函数
const onMessageNavigationButtonClick = () => {
  emit('messageNavigationToggle')
}

// Watch for changes and update store
watch(
  [
    temperature,
    contextLength,
    maxTokens,
    systemPrompt,
    artifacts,
    thinkingBudget,
    enableSearch,
    forcedSearch,
    searchStrategy,
    reasoningEffort,
    verbosity
  ],
  ([
    newTemp,
    newContext,
    newMaxTokens,
    newSystemPrompt,
    newArtifacts,
    newThinkingBudget,
    newEnableSearch,
    newForcedSearch,
    newSearchStrategy,
    newReasoningEffort,
    newVerbosity
  ]) => {
    if (
      newTemp !== chatStore.chatConfig.temperature ||
      newContext !== chatStore.chatConfig.contextLength ||
      newMaxTokens !== chatStore.chatConfig.maxTokens ||
      newSystemPrompt !== chatStore.chatConfig.systemPrompt ||
      newArtifacts !== chatStore.chatConfig.artifacts ||
      newThinkingBudget !== chatStore.chatConfig.thinkingBudget ||
      newEnableSearch !== chatStore.chatConfig.enableSearch ||
      newForcedSearch !== chatStore.chatConfig.forcedSearch ||
      newSearchStrategy !== chatStore.chatConfig.searchStrategy ||
      newReasoningEffort !== chatStore.chatConfig.reasoningEffort ||
      newVerbosity !== chatStore.chatConfig.verbosity
    ) {
      chatStore.updateChatConfig({
        temperature: newTemp,
        contextLength: newContext,
        maxTokens: newMaxTokens,
        systemPrompt: newSystemPrompt,
        artifacts: newArtifacts,
        thinkingBudget: newThinkingBudget,
        enableSearch: newEnableSearch,
        forcedSearch: newForcedSearch,
        searchStrategy: newSearchStrategy,
        reasoningEffort: newReasoningEffort,
        verbosity: newVerbosity
      } as any)
    }
  }
)

// Watch store changes to update local state
watch(
  () => chatStore.chatConfig,
  async (newConfig, oldConfig) => {
    temperature.value = newConfig.temperature
    contextLength.value = newConfig.contextLength
    maxTokens.value = newConfig.maxTokens
    systemPrompt.value = newConfig.systemPrompt
    artifacts.value = newConfig.artifacts
    thinkingBudget.value = newConfig.thinkingBudget
    enableSearch.value = newConfig.enableSearch
    forcedSearch.value = newConfig.forcedSearch
    searchStrategy.value = newConfig.searchStrategy
    reasoningEffort.value = newConfig.reasoningEffort
    verbosity.value = newConfig.verbosity
    if (
      oldConfig &&
      (newConfig.modelId !== oldConfig.modelId || newConfig.providerId !== oldConfig.providerId)
    ) {
      await loadModelConfig()
    }
  },
  { deep: true }
)

type Model = {
  name: string
  id: string
  providerId: string
  tags: string[]
}

const props = withDefaults(
  defineProps<{
    model?: Model
  }>(),
  {
    model: () => ({
      name: 'DeepSeek R1',
      id: 'deepseek-r1',
      providerId: '',
      tags: ['reasoning']
    })
  }
)

const modelSelectOpen = ref(false)
const handleModelUpdate = (model: MODEL_META) => {
  chatStore.updateChatConfig({
    modelId: model.id,
    providerId: model.providerId
  })

  // 保存用户的模型偏好设置
  configPresenter.setSetting('preferredModel', {
    modelId: model.id,
    providerId: model.providerId
  })

  modelSelectOpen.value = false
}

const isRateLimitEnabled = () => {
  if (!props.model?.providerId) return false
  const provider = settingsStore.providers.find((p) => p.id === props.model?.providerId)
  return provider?.rateLimit?.enabled ?? false
}

const loadRateLimitStatus = async () => {
  if (props.model?.providerId) {
    if (!isRateLimitEnabled()) {
      rateLimitStatus.value = null
      return
    }

    try {
      const status = await llmPresenter.getProviderRateLimitStatus(props.model.providerId)
      rateLimitStatus.value = status
    } catch (error) {
      console.error('Failed to load rate limit status:', error)
    }
  }
}

const handleRateLimitEvent = (data: any) => {
  if (data.providerId === props.model?.providerId) {
    if (data.config && !data.config.enabled) {
      rateLimitStatus.value = null
    } else {
      loadRateLimitStatus()
    }
    startRateLimitPolling()
  }
}

let statusInterval: ReturnType<typeof setInterval> | null = null

const startRateLimitPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
  }
  if (isRateLimitEnabled()) {
    statusInterval = setInterval(loadRateLimitStatus, 1000)
  }
}

const stopRateLimitPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
}

onMounted(async () => {
  if (props.model) {
    const config = await configPresenter.getModelDefaultConfig(props.model.id)
    contextLengthLimit.value = config.contextLength
    maxTokensLimit.value = config.maxTokens

    await loadRateLimitStatus()
  }

  setTimeout(async () => {
    await loadModelConfig()
  }, 100)

  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.CONFIG_UPDATED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_QUEUED, handleRateLimitEvent)

  // 只有在速率限制启用时才开始轮询
  startRateLimitPolling()
})

onUnmounted(() => {
  stopRateLimitPolling()
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.CONFIG_UPDATED)
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_EXECUTED)
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_QUEUED)
})

watch(
  () => props.model?.providerId,
  () => {
    loadRateLimitStatus()
    startRateLimitPolling()
  }
)

watch(
  () => settingsStore.providers,
  () => {
    loadRateLimitStatus()
    startRateLimitPolling()
  },
  { deep: true }
)
</script>

<style scoped></style>
