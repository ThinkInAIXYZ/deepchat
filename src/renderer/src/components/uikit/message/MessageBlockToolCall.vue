<script setup lang="ts">
import { computed, ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { BlockComponentProps, ToolCall } from '../types'

interface Props extends BlockComponentProps {
  toolCall: ToolCall
  showArguments?: boolean
  showResult?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  collapsible: true,
  defaultCollapsed: false,
  showArguments: true,
  showResult: true
})

const emit = defineEmits<{
  retry: [toolCall: ToolCall]
  expandToggle: [expanded: boolean]
}>()

const isOpen = ref(!props.defaultCollapsed)

const containerClasses = computed(() => cn('w-full', props.class))

const statusClasses = computed(() =>
  cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full', {
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200':
      props.toolCall.status === 'pending',
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200':
      props.toolCall.status === 'running',
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200':
      props.toolCall.status === 'completed',
    'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200': props.toolCall.status === 'error'
  })
)

const statusIcons = {
  pending: '⏳',
  running: '⚡',
  completed: '✅',
  error: '❌'
}

const handleRetry = () => {
  emit('retry', props.toolCall)
}

const handleExpandToggle = () => {
  isOpen.value = !isOpen.value
  emit('expandToggle', isOpen.value)
}
</script>

<template>
  <Card :class="containerClasses">
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CardTitle class="text-sm flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              />
            </svg>
            {{ toolCall.name }}
          </CardTitle>
          <Badge :class="statusClasses">
            {{ statusIcons[toolCall.status] }} {{ toolCall.status }}
          </Badge>
        </div>

        <div class="flex items-center gap-1">
          <Button v-if="toolCall.status === 'error'" variant="ghost" size="xs" @click="handleRetry">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </Button>

          <Button v-if="collapsible" variant="ghost" size="xs" @click="handleExpandToggle">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              :class="cn('transition-transform', { 'rotate-180': isOpen })"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Button>
        </div>
      </div>
    </CardHeader>

    <Collapsible v-model:open="isOpen">
      <CollapsibleContent>
        <CardContent class="pt-0 space-y-3">
          <!-- Arguments -->
          <div v-if="showArguments && Object.keys(toolCall.arguments).length > 0">
            <h4 class="text-xs font-medium text-muted-foreground mb-2">Arguments</h4>
            <div class="bg-muted/50 rounded-md p-3 text-sm font-mono">
              <pre class="text-xs whitespace-pre-wrap">{{
                JSON.stringify(toolCall.arguments, null, 2)
              }}</pre>
            </div>
          </div>

          <!-- Result -->
          <div v-if="showResult && (toolCall.result || toolCall.error)">
            <h4 class="text-xs font-medium text-muted-foreground mb-2">
              {{ toolCall.error ? 'Error' : 'Result' }}
            </h4>
            <div
              :class="
                cn('rounded-md p-3 text-sm font-mono', {
                  'bg-muted/50': !toolCall.error,
                  'bg-destructive/10 border border-destructive/20': toolCall.error
                })
              "
            >
              <pre class="text-xs whitespace-pre-wrap">{{
                toolCall.error ||
                (typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2))
              }}</pre>
            </div>
          </div>

          <!-- Loading state for running tools -->
          <div
            v-if="toolCall.status === 'running'"
            class="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="animate-spin"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Executing...
          </div>
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
