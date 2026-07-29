<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed } from 'vue'
import type { SurfaceFeedbackSnapshot } from './surfaceFeedbackController'

const props = defineProps<{
  snapshot: SurfaceFeedbackSnapshot
  retryLabel?: string
}>()

const emit = defineEmits<{
  retry: []
}>()

const icon = computed(() => {
  switch (props.snapshot.status) {
    case 'pending':
      return 'lucide:loader-circle'
    case 'success':
      return 'lucide:circle-check'
    case 'error':
      return 'lucide:circle-alert'
    case 'idle':
      return undefined
  }
})

const label = computed(() => {
  if (props.snapshot.status === 'idle') return ''
  if (props.snapshot.status === 'pending') return props.snapshot.label
  return props.snapshot.title
})

const accessibleLabel = computed(() => {
  if (props.snapshot.status === 'success' || props.snapshot.status === 'error') {
    return [props.snapshot.title, props.snapshot.description].filter(Boolean).join('. ')
  }
  return label.value
})
</script>

<template>
  <div
    v-if="snapshot.status !== 'idle'"
    data-testid="inline-operation-feedback"
    :data-status="snapshot.status"
    class="inline-operation-feedback"
    :role="snapshot.status === 'error' ? 'alert' : 'status'"
    :aria-label="accessibleLabel"
    :aria-live="snapshot.status === 'error' ? 'assertive' : 'polite'"
    aria-atomic="true"
  >
    <Icon
      v-if="icon"
      :icon="icon"
      class="size-3.5 shrink-0"
      :class="{
        'animate-spin motion-reduce:animate-none': snapshot.status === 'pending'
      }"
      aria-hidden="true"
    />
    <span class="min-w-0 truncate" :title="accessibleLabel">{{ label }}</span>
    <button
      v-if="snapshot.status === 'error' && retryLabel"
      type="button"
      class="shrink-0 rounded px-1 font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      @click="emit('retry')"
    >
      {{ retryLabel }}
    </button>
  </div>
</template>

<style scoped>
.inline-operation-feedback {
  display: inline-flex;
  max-width: min(360px, 100%);
  min-width: 0;
  min-height: 20px;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 20px;
}

.inline-operation-feedback[data-status='pending'] {
  color: var(--muted-foreground);
}

.inline-operation-feedback[data-status='success'] {
  color: var(--dc-notification-success-text);
}

.inline-operation-feedback[data-status='error'] {
  color: var(--dc-notification-error-text);
}
</style>
