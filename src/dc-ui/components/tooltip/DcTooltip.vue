<script setup lang="ts">
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { cn } from '@shadcn/lib/utils'

interface Props {
  content: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
  disabled?: boolean
  delayDuration?: number
}

const props = withDefaults(defineProps<Props>(), {
  side: 'top',
  sideOffset: 4,
  disabled: false,
  delayDuration: 200
})
</script>

<template>
  <TooltipProvider :delay-duration="delayDuration">
    <Tooltip :delay-duration="0" :ignore-non-keyboard-focus="true">
      <TooltipTrigger as-child :disabled="disabled">
        <slot />
      </TooltipTrigger>
      <TooltipContent :side="side" :side-offset="sideOffset" :class="cn(disabled && 'hidden')">
        {{ content }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
