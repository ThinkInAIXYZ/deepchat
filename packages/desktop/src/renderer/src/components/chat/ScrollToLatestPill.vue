<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'

/**
 * Floating "scroll to latest" affordance. It only requests scrolls: the chat scroll controller
 * remains the sole viewport writer.
 *
 * It returns to the bottom; the badge reports how many messages reach below the viewport. Fine
 * navigation through the conversation belongs to `ChatMinimap`, not to this pill.
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** Total of messages that reach below the viewport. */
    count?: number
  }>(),
  { count: 0 }
)

const emit = defineEmits<{
  (event: 'return'): void
}>()

const { t } = useI18n()
const label = computed(() => t('chat.messages.scrollToLatest'))
</script>

<template>
  <Transition name="scroll-to-latest">
    <div
      v-if="props.visible"
      class="pointer-events-auto flex items-center overflow-hidden rounded-full border border-border/70 bg-card/95 shadow-md"
      data-testid="scroll-to-latest"
    >
      <DcButton
        size="sm"
        variant="ghost"
        icon="lucide:arrow-down"
        class="gap-1.5 rounded-none"
        :tooltip="label"
        data-testid="scroll-to-latest-return"
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
    </div>
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
