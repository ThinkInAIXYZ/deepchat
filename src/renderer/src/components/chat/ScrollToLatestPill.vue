<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'

/**
 * Floating "scroll to latest" affordance. It only requests a scroll: the chat scroll controller
 * remains the sole viewport writer.
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** Loaded messages entirely below the viewport; 0 hides the count badge. */
    count?: number
  }>(),
  { count: 0 }
)

const emit = defineEmits<{ (event: 'return'): void }>()

const { t } = useI18n()
const label = computed(() => t('chat.messages.scrollToLatest'))
</script>

<template>
  <Transition name="scroll-to-latest">
    <DcButton
      v-if="props.visible"
      size="sm"
      variant="secondary"
      icon="lucide:arrow-down"
      :tooltip="label"
      class="pointer-events-auto gap-1.5 rounded-full shadow-md"
      data-testid="scroll-to-latest"
      @click="emit('return')"
    >
      <DcBadge
        v-if="props.count > 0"
        variant="neutral"
        class="px-1.5 tabular-nums"
        data-testid="scroll-to-latest-count"
      >
        {{ props.count }}
      </DcBadge>
    </DcButton>
  </Transition>
</template>

<style scoped>
.scroll-to-latest-enter-active,
.scroll-to-latest-leave-active {
  transition:
    opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.scroll-to-latest-enter-from,
.scroll-to-latest-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
  .scroll-to-latest-enter-active,
  .scroll-to-latest-leave-active {
    transition: none;
  }
}
</style>
