<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'

defineProps<{
  kind: 'file' | 'session'
  label: string
  source: string
  removable?: boolean
}>()
const emit = defineEmits<{ open: []; remove: [] }>()
const { t } = useI18n()
</script>

<template>
  <span
    class="group/reference inline-flex max-w-full items-center rounded bg-accent/70 px-1 align-baseline text-[0.93em] leading-[1.4] text-foreground"
    contenteditable="false"
    @keydown="removable && $event.stopPropagation()"
  >
    <Popover>
      <PopoverTrigger as-child>
        <button
          type="button"
          class="inline-flex min-w-0 items-baseline gap-1 rounded text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`${t('common.preview')} ${label}`"
          @mousedown.prevent
        >
          <Icon
            :icon="kind === 'session' ? 'lucide:messages-square' : 'lucide:file-text'"
            class="size-3 shrink-0 self-center text-muted-foreground"
          />
          <span data-chat-search-text class="min-w-0 [overflow-wrap:anywhere]">{{ label }}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        class="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3"
        @keydown.stop
        @mousedown.stop
      >
        <div class="space-y-1">
          <div class="text-sm font-medium [overflow-wrap:anywhere]">{{ label }}</div>
          <div
            class="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
          >
            {{ source }}
          </div>
        </div>
        <button
          type="button"
          class="rounded px-2 py-1 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          @click="emit('open')"
        >
          {{ t('common.open') }}
          <Icon icon="lucide:arrow-up-right" class="ml-1 inline size-3.5" />
        </button>
      </PopoverContent>
    </Popover>
    <button
      v-if="removable"
      type="button"
      class="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/reference:opacity-100 group-focus-within/reference:opacity-100 [@media(pointer:coarse)]:opacity-100"
      :aria-label="`${t('common.delete')} ${label}`"
      @mousedown.prevent
      @click="emit('remove')"
    >
      <Icon icon="lucide:x" class="size-3" />
    </button>
  </span>
</template>
