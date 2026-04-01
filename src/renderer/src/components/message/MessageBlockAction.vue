<template>
  <div :class="containerClass">
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

    <div
      v-else-if="isRateLimitBlock"
      data-rate-limit-block="true"
      class="inline-flex items-center gap-[10px] text-xs leading-4 text-[rgba(37,37,37,0.5)] dark:text-white/50"
    >
      <span class="whitespace-nowrap">
        {{ rateLimitStatusLabel }}
      </span>
      <Icon
        icon="lucide:ellipsis"
        class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50 animate-[pulse_1s_ease-in-out_infinite]"
      />
    </div>

    <Button
      v-if="block.extra?.needContinue && !isReadOnly"
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
import { Button } from '@shadcn/components/ui/button'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

const { t } = useI18n()

const props = defineProps<{
  messageId: string
  conversationId: string
  block: DisplayAssistantMessageBlock
  isReadOnly?: boolean
}>()

const emit = defineEmits<{
  continue: [conversationId: string, messageId: string]
}>()

const progressTimer = ref<number | null>(null)
const currentTime = ref(Date.now())
const isReadOnly = computed(() => props.isReadOnly === true)
const isRateLimitBlock = computed(() => props.block.action_type === 'rate_limit')
const elapsedSeconds = computed(() => {
  if (!isRateLimitBlock.value) {
    return 0
  }

  const elapsed = currentTime.value - props.block.timestamp
  return Math.max(0, Math.floor(Math.max(0, elapsed) / 1000))
})
const rateLimitStatusLabel = computed(() =>
  t('chat.messages.rateLimitCompactLoading', {
    seconds: elapsedSeconds.value
  })
)
const containerClass = computed(() =>
  isRateLimitBlock.value
    ? 'my-2'
    : 'flex flex-col w-[360px] break-all shadow-sm my-2 items-start p-2 gap-2 rounded-lg border bg-card text-card-foreground'
)

const handleClick = () => {
  emit('continue', props.conversationId, props.messageId)
}

onMounted(() => {
  if (isRateLimitBlock.value) {
    progressTimer.value = window.setInterval(() => {
      currentTime.value = Date.now()
    }, 1000)
  }
})

onUnmounted(() => {
  if (progressTimer.value) {
    clearInterval(progressTimer.value)
  }
})
</script>
