<template>
  <Popover v-bind="$attrs">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverContent
      :align="align"
      :class="cn('p-0', contentClass, enableScrollable && 'max-h-96 overflow-hidden')"
    >
      <div v-if="enableScrollable" class="max-h-96 overflow-y-auto">
        <slot />
      </div>
      <slot v-else />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ScrollablePopoverProps {
  align?: 'start' | 'center' | 'end'
  enableScrollable?: boolean
  contentClass?: HTMLAttributes['class']
}

withDefaults(defineProps<ScrollablePopoverProps>(), {
  align: 'center',
  enableScrollable: false,
  contentClass: ''
})
</script>
