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
      <ScrollablePopover align="end" content-class="w-80" :enable-scrollable="true">
        <template #trigger>
          <Button class="w-7 h-7 rounded-md" size="icon" variant="outline">
            <Icon icon="lucide:settings-2" class="w-4 h-4" />
          </Button>
        </template>
        <ChatConfig
          v-model:system-prompt="systemPrompt"
          :temperature="temperature"
          :context-length="contextLength"
          :max-tokens="maxTokens"
          :artifacts="artifacts"
          :thinking-budget="thinkingBudget"
          :model-id="chatStore.chatConfig.modelId"
          :provider-id="chatStore.chatConfig.providerId"
          @update:temperature="updateTemperature"
          @update:context-length="updateContextLength"
          @update:max-tokens="updateMaxTokens"
          @update:artifacts="updateArtifacts"
          @update:thinking-budget="updateThinkingBudget"
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
import { ModelType } from '@shared/model'
import { RATE_LIMIT_EVENTS } from '@/events'

const configPresenter = usePresenter('configPresenter')
const llmPresenter = usePresenter('llmproviderPresenter')

const { t } = useI18n()
const chatStore = useChatStore()
const themeStore = useThemeStore()
// Chat configuration state
const temperature = ref(chatStore.chatConfig.temperature)
const contextLength = ref(chatStore.chatConfig.contextLength)
const maxTokens = ref(chatStore.chatConfig.maxTokens)
const systemPrompt = ref(chatStore.chatConfig.systemPrompt)
const artifacts = ref(chatStore.chatConfig.artifacts)
const thinkingBudget = ref(chatStore.chatConfig.thinkingBudget)
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

const onSidebarButtonClick = () => {
  chatStore.isSidebarOpen = !chatStore.isSidebarOpen
}

// Watch for changes and update store
watch(
  [temperature, contextLength, maxTokens, systemPrompt, artifacts, thinkingBudget],
  ([newTemp, newContext, newMaxTokens, newSystemPrompt, newArtifacts, newThinkingBudget]) => {
    if (
      newTemp !== chatStore.chatConfig.temperature ||
      newContext !== chatStore.chatConfig.contextLength ||
      newMaxTokens !== chatStore.chatConfig.maxTokens ||
      newSystemPrompt !== chatStore.chatConfig.systemPrompt ||
      newArtifacts !== chatStore.chatConfig.artifacts ||
      newThinkingBudget !== chatStore.chatConfig.thinkingBudget
    ) {
      chatStore.updateChatConfig({
        temperature: newTemp,
        contextLength: newContext,
        maxTokens: newMaxTokens,
        systemPrompt: newSystemPrompt,
        artifacts: newArtifacts,
        thinkingBudget: newThinkingBudget
      })
    }
  }
)

// Watch store changes to update local state
watch(
  () => chatStore.chatConfig,
  (newConfig) => {
    temperature.value = newConfig.temperature
    contextLength.value = newConfig.contextLength
    maxTokens.value = newConfig.maxTokens
    systemPrompt.value = newConfig.systemPrompt
    artifacts.value = newConfig.artifacts
    thinkingBudget.value = newConfig.thinkingBudget
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

const loadRateLimitStatus = async () => {
  if (props.model?.providerId) {
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
    loadRateLimitStatus()
  }
}

let statusInterval: number | null = null

onMounted(async () => {
  if (props.model) {
    const config = await configPresenter.getModelDefaultConfig(props.model.id)
    contextLengthLimit.value = config.contextLength
    maxTokensLimit.value = config.maxTokens

    await loadRateLimitStatus()
  }

  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.CONFIG_UPDATED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_QUEUED, handleRateLimitEvent)

  statusInterval = window.setInterval(loadRateLimitStatus, 1000)
})

onUnmounted(() => {
  if (statusInterval) {
    clearInterval(statusInterval)
  }
  window.electron.ipcRenderer.removeListener(RATE_LIMIT_EVENTS.CONFIG_UPDATED, handleRateLimitEvent)
  window.electron.ipcRenderer.removeListener(
    RATE_LIMIT_EVENTS.REQUEST_EXECUTED,
    handleRateLimitEvent
  )
  window.electron.ipcRenderer.removeListener(RATE_LIMIT_EVENTS.REQUEST_QUEUED, handleRateLimitEvent)
})

watch(
  () => props.model?.providerId,
  () => {
    loadRateLimitStatus()
  }
)
</script>

<style scoped></style>
