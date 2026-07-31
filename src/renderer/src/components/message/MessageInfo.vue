<template>
  <div class="flex flex-row items-center gap-2 h-4">
    <span class="text-xs font-bold text-foreground">{{ name }}</span>
    <span class="text-xs text-text-secondary-foreground">{{ formattedTime }}</span>
    <Transition name="message-receipt">
      <span
        v-if="receipt"
        class="text-xs text-text-secondary-foreground"
        :aria-live="receipt === 'read' ? 'polite' : 'off'"
        :aria-atomic="receipt === 'read' ? 'true' : undefined"
        data-testid="message-input-receipt"
      >
        {{ receiptLabel }}
      </span>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  timestamp: number
  receipt?: 'unread' | 'read' | null
  receiptLabel?: string
}>()

const formattedTime = computed(() => {
  if (!props.timestamp) {
    return ''
  }
  const date = new Date(props.timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
})
</script>

<style scoped>
.message-receipt-leave-active {
  transition: opacity 150ms ease;
}

.message-receipt-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .message-receipt-leave-active {
    transition: none;
  }
}
</style>
