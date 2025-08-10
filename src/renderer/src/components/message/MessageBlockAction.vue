<template>
  <div
    class="flex flex-col w-[360px] break-all shadow-sm my-2 items-start p-2 gap-2 rounded-lg border bg-card text-card-foreground"
  >
    <div v-if="block.extra?.needContinue" class="flex flex-row items-center gap-2 w-full">
      <div class="flex flex-row gap-2 items-center cursor-pointer">
        <Icon icon="lucide:info" class="w-4 h-4 text-red-500/80" />
      </div>
      <div
        class="prose prose-sm max-w-full break-all whitespace-pre-wrap leading-7 text-left text-card-foreground"
      >
        {{ t(block.content || '') }}
      </div>
    </div>

    <div v-else-if="block.action_type === 'rate_limit'" class="flex flex-col gap-3 w-full">
      <div class="flex flex-row items-center gap-2 w-full">
        <Icon icon="lucide:clock" class="w-4 h-4 text-orange-500 animate-pulse" />
        <div class="flex flex-col gap-1">
          <div class="text-sm font-medium text-card-foreground">
            {{ t('chat.messages.rateLimitTitle') }}
          </div>
          <div class="text-xs text-muted-foreground">
            {{ getProviderName(block.extra?.providerId) }}
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 text-xs">
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('chat.messages.rateLimitQueue') }}:</span>
          <span class="font-mono">{{ block.extra?.queueLength || 0 }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('chat.messages.rateLimitEstimated') }}:</span>
          <span class="font-mono">{{ formatEstimatedTime(block.extra?.estimatedWaitTime) }}</span>
        </div>
      </div>

      <div class="w-full bg-secondary rounded-full h-1.5">
        <div
          class="bg-orange-500 h-1.5 rounded-full transition-all duration-1000 animate-pulse"
          :style="{ width: `${getProgressWidth()}%` }"
        ></div>
      </div>

      <div class="flex flex-row gap-2">
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="handleQuickSettings">
          <Icon icon="lucide:settings" class="w-3 h-3 mr-1" />
          {{ t('chat.messages.rateLimitQuickSettings') }}
        </Button>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="handleSwitchProvider">
          <Icon icon="lucide:shuffle" class="w-3 h-3 mr-1" />
          {{ t('chat.messages.rateLimitSwitchProvider') }}
        </Button>
      </div>
    </div>

    <Button
      v-if="block.extra?.needContinue"
      class="bg-primary rounded-lg hover:bg-indigo-600/50 h-8"
      size="sm"
      @click="handleClick"
    >
      <Icon icon="lucide:check" class="w-4 h-4" />
      {{ t('components.messageBlockAction.continue') }}
    </Button>
    <div
      v-if="!block.extra?.needContinue && block.action_type !== 'rate_limit'"
      class="text-xs text-gray-500 flex flex-row gap-2 items-center"
    >
      <Icon icon="lucide:check" class="w-4 h-4" />{{ t('components.messageBlockAction.continued') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chat'
import { AssistantMessageBlock } from '@shared/chat'
import { ref, onMounted, onUnmounted } from 'vue'

const { t } = useI18n()
const chatStore = useChatStore()

const props = defineProps<{
  messageId: string
  conversationId: string
  block: AssistantMessageBlock
}>()

const progressTimer = ref<number | null>(null)
const currentTime = ref(Date.now())

const getProviderName = (providerId?: string | number | boolean | object[]) => {
  if (!providerId || typeof providerId !== 'string') return 'Unknown Provider'
  return providerId.charAt(0).toUpperCase() + providerId.slice(1)
}

const formatEstimatedTime = (estimatedWaitTime?: string | number | boolean | object[]) => {
  if (!estimatedWaitTime || typeof estimatedWaitTime !== 'number' || estimatedWaitTime <= 0) {
    return t('chat.messages.rateLimitImmediately')
  }

  const seconds = Math.ceil(estimatedWaitTime / 1000)
  if (seconds < 60) {
    return `${seconds}${t('chat.messages.rateLimitSeconds')}`
  }

  const minutes = Math.ceil(seconds / 60)
  return `${minutes}${t('chat.messages.rateLimitMinutes')}`
}

const getProgressWidth = () => {
  const estimatedWaitTime = props.block.extra?.estimatedWaitTime
  if (!estimatedWaitTime || typeof estimatedWaitTime !== 'number') return 100

  const elapsed = currentTime.value - props.block.timestamp
  const total = estimatedWaitTime
  const progress = Math.min(100, (elapsed / total) * 100)

  return Math.max(10, progress)
}

const handleQuickSettings = () => {
  window.electron.ipcRenderer.invoke('open-settings', {
    tab: 'providers',
    providerId: props.block.extra?.providerId
  })
}

const handleSwitchProvider = () => {
  chatStore.showProviderSelector()
}

const handleClick = () => {
  console.log('handleClick')
  chatStore.continueStream(props.conversationId, props.messageId)
}

onMounted(() => {
  if (props.block.action_type === 'rate_limit') {
    progressTimer.value = window.setInterval(() => {
      currentTime.value = Date.now()
    }, 100)
  }
})

onUnmounted(() => {
  if (progressTimer.value) {
    clearInterval(progressTimer.value)
  }
})
</script>
