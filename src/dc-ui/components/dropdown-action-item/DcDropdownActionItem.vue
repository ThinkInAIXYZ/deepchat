<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Icon } from '@iconify/vue'
import { DropdownMenuItem } from '@shadcn/components/ui/dropdown-menu'
import { cn } from '@shadcn/lib/utils'

defineOptions({ inheritAttrs: false })

interface Props {
  icon?: string
  label: string
  danger?: boolean
  disabled?: boolean
  inset?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  danger: false,
  disabled: false
})

const emit = defineEmits<{
  (e: 'select'): void
}>()
</script>

<template>
  <DropdownMenuItem
    v-bind="$attrs"
    :variant="danger ? 'destructive' : 'default'"
    :disabled="disabled"
    :inset="inset"
    :class="cn('gap-2', props.class)"
    @select="emit('select')"
    @click.stop
  >
    <Icon v-if="icon" :icon="icon" class="size-4 shrink-0" />
    <span class="min-w-0 flex-1 truncate">{{ label }}</span>
    <slot />
  </DropdownMenuItem>
</template>
