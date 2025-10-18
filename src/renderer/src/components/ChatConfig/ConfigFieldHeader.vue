<script setup lang="ts">
// === Components ===
import { Icon } from '@iconify/vue'
import { Label } from '@shadcn/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'

// === Props ===
defineProps<{
  icon: string
  label: string
  description?: string
  size?: 'sm' | 'xs'
  value?: string | number
}>()
</script>

<template>
  <div class="flex items-center" :class="value !== undefined ? 'justify-between' : 'space-x-2'">
    <div class="flex items-center space-x-2">
      <Icon :icon="icon" class="w-4 h-4 text-muted-foreground" />
      <Label :class="size === 'sm' ? 'text-sm' : 'text-xs font-medium'">{{ label }}</Label>
      <TooltipProvider v-if="description" :delayDuration="200">
        <Tooltip>
          <TooltipTrigger>
            <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p>{{ description }}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <span v-if="value !== undefined" class="text-xs text-muted-foreground">{{ value }}</span>
  </div>
</template>
