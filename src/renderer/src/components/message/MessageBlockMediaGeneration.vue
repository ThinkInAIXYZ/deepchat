<template>
  <div
    class="flex flex-col w-[360px] break-all shadow-sm my-2 items-start p-3 gap-3 rounded-lg border bg-card text-card-foreground"
  >
    <!-- Header -->
    <div class="flex flex-row items-center gap-2 w-full">
      <Icon
        :icon="mediaType === 'video' ? 'lucide:film' : 'lucide:image'"
        class="w-5 h-5 text-primary"
      />
      <div class="flex flex-col gap-0.5">
        <div class="text-sm font-medium text-card-foreground">
          {{ t(getTitleKey()) }}
        </div>
        <div class="text-xs text-muted-foreground">
          {{ getStatusMessage() }}
        </div>
      </div>
    </div>

    <!-- Progress indicator -->
    <div class="w-full space-y-1">
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>{{ getProgressLabel() }}</span>
        <span v-if="pollCount > 0"> {{ pollCount }} / {{ maxPolls || '∞' }} </span>
      </div>
      <div class="w-full bg-secondary rounded-full h-2">
        <div
          class="bg-primary h-2 rounded-full transition-all duration-500"
          :style="{ width: `${progressPercentage}%` }"
        ></div>
      </div>
    </div>

    <!-- Status message -->
    <div class="text-xs text-muted-foreground flex flex-row gap-2 items-center" v-if="content">
      <Icon icon="lucide:info" class="w-3 h-3" />
      <span class="truncate">{{ content }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { computed } from 'vue'
import { AssistantMessageBlock } from '@shared/chat'

const { t } = useI18n()

const props = defineProps<{
  messageId: string
  conversationId: string
  block: AssistantMessageBlock
}>()

// Extract values from block.extra safely
const mediaType = computed(() => {
  return (props.block.extra?.mediaType as 'image' | 'video') || 'image'
})

const status = computed(() => {
  return (
    (props.block.extra?.status as 'queued' | 'processing' | 'completed' | 'failed' | 'error') ||
    'queued'
  )
})

const pollCount = computed(() => {
  return (props.block.extra?.pollCount as number) || 0
})

const maxPolls = computed(() => {
  return (props.block.extra?.maxPolls as number) || 0
})

const content = computed(() => props.block.content || '')

// Progress percentage for visual indicator
const progressPercentage = computed(() => {
  if (status.value === 'error') return 100
  if (!maxPolls.value || maxPolls.value === 0) {
    // If no max polls defined, show indeterminate progress
    return Math.min(90, (pollCount.value % 10) * 9)
  }
  return Math.min(100, (pollCount.value / maxPolls.value) * 100)
})

const getTitleKey = () => {
  const type = mediaType.value === 'video' ? 'video' : 'image'
  return `chat.messages.mediaGeneration.${type}Generating`
}

const getStatusMessage = () => {
  const statusKey = status.value === 'error' ? 'timeout' : status.value
  return t(`chat.messages.mediaGeneration.status.${statusKey}`)
}

const getProgressLabel = () => {
  if (status.value === 'queued') {
    return t('chat.messages.mediaGeneration.waiting')
  }
  if (status.value === 'processing') {
    return t('chat.messages.mediaGeneration.processing')
  }
  if (status.value === 'error') {
    return t('chat.messages.mediaGeneration.stopped')
  }
  return t('chat.messages.mediaGeneration.pending')
}
</script>
