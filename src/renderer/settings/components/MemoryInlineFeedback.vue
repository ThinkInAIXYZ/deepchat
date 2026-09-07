<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import type { MemoryInlineFeedbackState } from '../lib/useMemoryInlineFeedback'

const props = defineProps<{
  feedback: MemoryInlineFeedbackState
}>()

const emit = defineEmits<{
  clear: []
}>()

const { t } = useI18n()
const icon = computed(() => {
  if (props.feedback.tone === 'error') return 'lucide:circle-alert'
  if (props.feedback.tone === 'warning') return 'lucide:triangle-alert'
  return 'lucide:info'
})
</script>

<template>
  <div
    data-testid="memory-inline-feedback"
    :data-tone="feedback.tone"
    class="flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs"
    :class="{
      'border-destructive/40 bg-destructive/5 text-destructive': feedback.tone === 'error',
      'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300':
        feedback.tone === 'warning',
      'border-border bg-muted/50 text-muted-foreground': feedback.tone === 'info'
    }"
    :role="feedback.tone === 'info' ? 'status' : 'alert'"
    :aria-live="feedback.tone === 'info' ? 'polite' : 'assertive'"
  >
    <Icon :icon="icon" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p class="font-medium leading-5">{{ feedback.title }}</p>
      <p
        v-if="feedback.description"
        class="line-clamp-2 leading-4 text-muted-foreground"
        :title="feedback.description"
      >
        {{ feedback.description }}
      </p>
    </div>
    <button
      type="button"
      class="mt-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :aria-label="t('common.close')"
      @click="emit('clear')"
    >
      <Icon icon="lucide:x" class="size-3.5" aria-hidden="true" />
    </button>
  </div>
</template>
