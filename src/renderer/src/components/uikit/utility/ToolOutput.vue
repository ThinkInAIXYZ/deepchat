<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { BaseComponentProps } from '../types'

interface Props extends BaseComponentProps {
  title?: string
  output: any
  format?: 'text' | 'json' | 'code' | 'html' | 'markdown'
  language?: string
  status?: 'success' | 'error' | 'warning' | 'info'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  format: 'text',
  status: 'info'
})

const containerClasses = computed(() => 
  cn(
    'w-full',
    props.class
  )
)

const statusClasses = computed(() => 
  cn(
    'text-xs px-2 py-1 rounded-full',
    {
      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200': props.status === 'success',
      'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200': props.status === 'error',
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200': props.status === 'warning',
      'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200': props.status === 'info'
    }
  )
)

const contentClasses = computed(() =>
  cn(
    'rounded-md p-3 text-sm',
    {
      'bg-muted/50 font-mono': props.format === 'code' || props.format === 'json',
      'bg-background border': props.format === 'html',
      'prose prose-sm dark:prose-invert max-w-none': props.format === 'markdown'
    }
  )
)

const formatOutput = (output: any) => {
  if (typeof output === 'string') return output
  
  if (props.format === 'json') {
    return JSON.stringify(output, null, 2)
  }
  
  return String(output)
}

const getIcon = () => {
  switch (props.status) {
    case 'success': return '✅'
    case 'error': return '❌'  
    case 'warning': return '⚠️'
    default: return 'ℹ️'
  }
}
</script>

<template>
  <Card :class="containerClasses">
    <CardHeader v-if="title || status" class="pb-2">
      <div class="flex items-center justify-between">
        <CardTitle v-if="title" class="text-sm">
          {{ title }}
        </CardTitle>
        
        <Badge :class="statusClasses">
          {{ getIcon() }} {{ status }}
        </Badge>
      </div>
    </CardHeader>

    <CardContent class="pt-0">
      <div :class="contentClasses">
        <!-- Text/Code/JSON Output -->
        <pre 
          v-if="format === 'text' || format === 'code' || format === 'json'" 
          class="whitespace-pre-wrap break-words text-xs"
        >{{ formatOutput(output) }}</pre>
        
        <!-- HTML Output -->
        <div 
          v-else-if="format === 'html'" 
          v-html="output"
          class="prose prose-sm dark:prose-invert max-w-none"
        />
        
        <!-- Markdown Output -->
        <div 
          v-else-if="format === 'markdown'"
          class="markdown-content"
        >
          <!-- Would need a markdown renderer component here -->
          <pre class="whitespace-pre-wrap break-words text-xs">{{ formatOutput(output) }}</pre>
        </div>

        <!-- Fallback -->
        <div v-else class="text-xs">
          {{ formatOutput(output) }}
        </div>
      </div>

      <!-- Actions slot -->
      <div v-if="$slots.actions" class="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <slot name="actions" :output="output" :format="format" />
      </div>
    </CardContent>
  </Card>
</template>