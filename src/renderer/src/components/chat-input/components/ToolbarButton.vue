<template>
  <Tooltip>
    <TooltipTrigger>
      <Button
        variant="outline"
        size="icon"
        :class="[
          'w-7 h-7 text-xs rounded-lg',
          variant === 'chat' ? 'text-accent-foreground' : '',
          isActive ? 'text-primary' : ''
        ]"
        @click="handleClick"
      >
        <Icon :icon="icon" class="w-4 h-4" />
        <slot name="extra"></slot>
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ tooltip }}</TooltipContent>
  </Tooltip>
</template>

<script setup lang="ts">
// === Components ===
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'

// === Props & Emits ===
defineProps<{
  icon: string
  tooltip: string
  variant?: 'chat' | 'newThread'
  isActive?: boolean
}>()

const emit = defineEmits(['click'])

// === Event Handlers ===
const handleClick = () => {
  emit('click')
}
</script>
