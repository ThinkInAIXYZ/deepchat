<template>
  <div class="flex items-center gap-2 flex-wrap">
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
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'

defineProps<{
  variant: 'agent' | 'newThread' | 'acp'
  shouldShowContextLength: boolean
  currentContextLengthText: string
  contextLengthStatusClass: string
  canSendImmediately: boolean
  isStreaming: boolean
  disabledSend: boolean
}>()

defineEmits<{
  send: []
  cancel: []
}>()
</script>
