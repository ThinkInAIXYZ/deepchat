<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Badge } from '@/components/ui/badge'
import type { BaseComponentProps } from '../types'

interface Citation {
  id: string
  title: string
  url?: string
  excerpt?: string
  source?: string
  timestamp?: Date | string
}

interface Props extends BaseComponentProps {
  citation: Citation
  index?: number
  inline?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  inline: true
})

const emit = defineEmits<{
  click: [citation: Citation]
  navigate: [url: string]
}>()

const citationClasses = computed(() => 
  cn(
    'inline-flex items-center gap-1 text-xs',
    {
      'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300': true,
      'cursor-pointer': props.citation.url,
      'mx-0.5': props.inline
    },
    props.class
  )
)

const handleClick = () => {
  emit('click', props.citation)
  if (props.citation.url) {
    emit('navigate', props.citation.url)
  }
}

const formatTimestamp = (timestamp: Date | string) => {
  if (typeof timestamp === 'string') return timestamp
  return timestamp.toLocaleDateString()
}
</script>

<template>
  <HoverCard>
    <HoverCardTrigger as-child>
      <span 
        :class="citationClasses"
        @click="handleClick"
      >
        <span class="font-medium">
          [{{ index || citation.id }}]
        </span>
        <slot :citation="citation" />
      </span>
    </HoverCardTrigger>

    <HoverCardContent side="top" class="w-80">
      <div class="space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h4 class="text-sm font-semibold text-foreground line-clamp-2">
            {{ citation.title }}
          </h4>
          
          <svg 
            v-if="citation.url"
            xmlns="http://www.w3.org/2000/svg" 
            width="12" 
            height="12" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2"
            class="shrink-0 mt-0.5 text-muted-foreground"
          >
            <path d="M7 17L17 7"/>
            <path d="M7 7h10v10"/>
          </svg>
        </div>

        <p v-if="citation.excerpt" class="text-xs text-muted-foreground line-clamp-3">
          {{ citation.excerpt }}
        </p>

        <div class="flex items-center gap-2 pt-1">
          <Badge v-if="citation.source" variant="outline" class="text-xs">
            {{ citation.source }}
          </Badge>
          
          <span v-if="citation.timestamp" class="text-xs text-muted-foreground">
            {{ formatTimestamp(citation.timestamp) }}
          </span>
        </div>

        <div v-if="citation.url" class="text-xs text-blue-600 dark:text-blue-400 truncate">
          {{ citation.url }}
        </div>
      </div>
    </HoverCardContent>
  </HoverCard>
</template>