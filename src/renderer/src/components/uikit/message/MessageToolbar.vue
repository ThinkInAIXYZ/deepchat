<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { BaseComponentProps, MessageContent } from '../types'

interface Props extends BaseComponentProps {
  message: MessageContent
  actions?: Array<{
    id: string
    label: string
    icon?: string
    tooltip?: string
    disabled?: boolean
    visible?: boolean
  }>
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  actions: () => []
})

const emit = defineEmits<{
  action: [actionId: string, message: MessageContent]
}>()

const toolbarClasses = computed(() => 
  cn(
    'flex items-center gap-1 opacity-0 group-hover:opacity-100',
    'transition-opacity duration-200',
    props.class
  )
)

const handleAction = (actionId: string) => {
  emit('action', actionId, props.message)
}

// Default actions
const defaultActions = [
  { id: 'copy', label: 'Copy', tooltip: 'Copy message', icon: 'copy', visible: true, disabled: false },
  { id: 'edit', label: 'Edit', tooltip: 'Edit message', icon: 'edit', visible: true, disabled: false },
  { id: 'regenerate', label: 'Regenerate', tooltip: 'Regenerate response', icon: 'refresh', visible: true, disabled: false },
  { id: 'delete', label: 'Delete', tooltip: 'Delete message', icon: 'delete', visible: true, disabled: false }
]

const visibleActions = computed(() => 
  props.actions.length > 0 ? props.actions : defaultActions
)
</script>

<template>
  <TooltipProvider>
    <div :class="toolbarClasses">
      <template 
        v-for="action in visibleActions" 
        :key="action.id"
      >
        <Tooltip v-if="action.visible !== false">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="xs"
              :disabled="action.disabled"
              @click="handleAction(action.id)"
            >
              <slot :name="`icon-${action.id}`" :action="action">
                <!-- Default icons would be implemented here -->
                <span class="text-xs">{{ action.label.charAt(0) }}</span>
              </slot>
            </Button>
          </TooltipTrigger>
          <TooltipContent v-if="action.tooltip">
            {{ action.tooltip }}
          </TooltipContent>
        </Tooltip>
      </template>

      <!-- Custom actions slot -->
      <slot name="actions" :message="message" :handleAction="handleAction" />
    </div>
  </TooltipProvider>
</template>