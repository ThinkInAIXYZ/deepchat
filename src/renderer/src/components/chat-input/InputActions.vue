<template>
  <div class="flex items-center gap-2 flex-wrap">
    <!-- Rate Limit Status -->
    <Tooltip v-if="shouldShowRateLimit">
      <TooltipTrigger as-child>
        <div class="flex items-center gap-1 text-xs">
          <Icon
            :icon="resolvedRateLimitIcon"
            :class="['w-3.5 h-3.5', rateLimitStatusClass]"
          />
          <span v-if="hasQueue && rateLimitQueueText">{{ rateLimitQueueText }}</span>
          <span v-else-if="showWaitTime">{{ rateLimitWaitTime }}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent v-if="rateLimitTooltip">{{ rateLimitTooltip }}</TooltipContent>
    </Tooltip>

    <!-- Context Length Display -->
    <div
      v-if="shouldShowContextLength"
      :class="[
        'text-xs',
        variant === 'agent' ? 'text-muted-foreground dark:text-white/60' : 'text-muted-foreground',
        contextLengthStatusClass
      ]"
    >
      {{ currentContextLengthText }}
    </div>

    <!-- Addon Actions Slot -->
    <slot name="addon-actions"></slot>

    <!-- Send/Stop Button -->
    <Button
      v-if="!isStreaming || variant === 'newThread'"
      variant="default"
      size="icon-sm"
      class="w-7 h-7"
      :disabled="disabledSend"
      @click="$emit('send')"
    >
      <Icon icon="lucide:arrow-up" class="w-4 h-4" />
    </Button>
    <Button
      v-else-if="isStreaming && (variant === 'agent' || variant === 'acp')"
      key="cancel"
      variant="outline"
      size="icon"
      class="w-7 h-7"
      @click="$emit('cancel')"
    >
      <Icon
        icon="lucide:square"
        class="w-6 h-6 bg-red-500 p-1 text-primary-foreground rounded-full"
      />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import type { RateLimitStatus } from '@/composables/rate-limit/useRateLimitAdapter'

const props = defineProps<{
  variant: 'agent' | 'newThread' | 'acp'
  shouldShowContextLength: boolean
  currentContextLengthText: string
  contextLengthStatusClass: string
  canSendImmediately?: boolean
  isStreaming: boolean
  disabledSend: boolean
  rateLimitStatus?: RateLimitStatus | null
  rateLimitStatusClass?: string
  rateLimitTooltip?: string
  rateLimitIcon?: string
  rateLimitQueueText?: string
  rateLimitWaitTime?: string
}>()

defineEmits<{
  send: []
  cancel: []
}>()

const shouldShowRateLimit = computed(
  () => !!props.rateLimitStatus && !!props.rateLimitIcon && !!props.rateLimitStatusClass
)
const hasQueue = computed(() => (props.rateLimitStatus?.queueLength ?? 0) > 0)
const showWaitTime = computed(
  () => !hasQueue.value && !props.canSendImmediately && !!props.rateLimitWaitTime
)
const resolvedRateLimitIcon = computed(() => props.rateLimitIcon ?? 'lucide:clock')
</script>
