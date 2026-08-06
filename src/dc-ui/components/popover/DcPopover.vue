<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { cn } from '@shadcn/lib/utils'

defineOptions({
  inheritAttrs: false
})

interface Props {
  open?: boolean
  widthClass?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  showHeader?: boolean
  contentClass?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  widthClass: 'w-80',
  align: 'end',
  side: 'bottom',
  sideOffset: 4,
  showHeader: false
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()
</script>

<template>
  <Popover :open="open" @update:open="emit('update:open', $event)">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverContent
      v-bind="$attrs"
      :align="align"
      :side="side"
      :side-offset="sideOffset"
      :class="cn('overflow-hidden p-0', props.widthClass, props.contentClass)"
    >
      <div v-if="showHeader || $slots.header" class="border-b px-3 py-2">
        <slot name="header">
          <div class="flex items-center justify-between gap-2">
            <slot name="title" />
            <slot name="header-actions" />
          </div>
        </slot>
      </div>
      <slot />
    </PopoverContent>
  </Popover>
</template>
