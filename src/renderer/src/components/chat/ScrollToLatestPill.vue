<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import type { ScrollToLatestItem } from '@/features/chat-page/model/scrollToLatestItems'

/**
 * Floating "scroll to latest" affordance. It only requests scrolls: the chat scroll controller
 * remains the sole viewport writer.
 *
 * The pill body returns to the bottom; the chevron beside it opens the preview of the messages
 * below the viewport so the user can jump straight to one of them.
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** True total of messages below the viewport; the preview list may be shorter. */
    count?: number
    items?: ScrollToLatestItem[]
  }>(),
  { count: 0, items: () => [] }
)

const emit = defineEmits<{
  (event: 'return'): void
  (event: 'jump', messageId: string): void
}>()

const { t } = useI18n()
const label = computed(() => t('chat.messages.scrollToLatest'))
const previewOpen = ref(false)

// A popover anchored to a trigger that just disappeared would stay orphaned on screen.
watch(
  () => props.visible,
  (visible) => {
    if (!visible) previewOpen.value = false
  }
)
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

      <Popover v-model:open="previewOpen">
        <PopoverTrigger as-child>
          <DcButton
            size="sm"
            variant="ghost"
            icon="lucide:chevron-up"
            class="rounded-none border-l border-border/70"
            :tooltip="t('chat.messages.expandNewerMessages')"
            data-testid="scroll-to-latest-expand"
          />
        </PopoverTrigger>
        <PopoverContent side="top" align="end" class="w-[min(92vw,26rem)] p-0">
          <div class="border-b px-3 py-2 text-sm font-medium">
            {{ t('chat.messages.newerMessages') }}
          </div>
          <div class="dc-overscroll-contain max-h-80 overflow-y-auto p-1">
            <button
              v-for="item in props.items"
              :key="item.id"
              type="button"
              class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              :aria-label="t('chat.messages.jumpToMessage')"
              :data-testid="`scroll-to-latest-item-${item.id}`"
              @click="emit('jump', item.id)"
            >
              <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon
                  v-if="item.streaming"
                  icon="lucide:loader-circle"
                  class="size-3 animate-spin"
                />
                <Icon v-else-if="item.failed" icon="lucide:circle-alert" class="size-3" />
                <Icon
                  v-else
                  :icon="item.role === 'user' ? 'lucide:user' : 'lucide:sparkles'"
                  class="size-3"
                />
              </span>
              <span class="line-clamp-2 text-xs text-foreground/90">{{ item.text }}</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
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
