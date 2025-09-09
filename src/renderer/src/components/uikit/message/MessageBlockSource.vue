<script setup lang="ts">
import { computed, ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { BlockComponentProps, SearchResult } from '../types'

interface Props extends BlockComponentProps {
  query?: string
  results?: SearchResult[]
  totalResults?: number
  searchTime?: number
  status?: 'searching' | 'completed' | 'error'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  results: () => [],
  status: 'completed',
  collapsible: true,
  defaultCollapsed: false
})

const emit = defineEmits<{
  resultClick: [result: SearchResult]
  expandToggle: [expanded: boolean]
}>()

const isOpen = ref(!props.defaultCollapsed)

const containerClasses = computed(() => cn('w-full', props.class))

const statusClasses = computed(() =>
  cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full', {
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200': props.status === 'searching',
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200':
      props.status === 'completed',
    'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200': props.status === 'error'
  })
)

const handleResultClick = (result: SearchResult) => {
  emit('resultClick', result)
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
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            Search Results
          </CardTitle>
          <Badge :class="statusClasses">
            {{
              status === 'searching' ? 'Searching...' : `${totalResults || results.length} results`
            }}
          </Badge>
        </div>

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

      <div v-if="query" class="text-xs text-muted-foreground">
        Query: "{{ query }}"
        <span v-if="searchTime"> • {{ searchTime }}ms</span>
      </div>
    </CardHeader>

    <Collapsible v-model:open="isOpen">
      <CollapsibleContent>
        <CardContent class="pt-0">
          <div v-if="results.length > 0" class="space-y-3">
            <div
              v-for="result in results"
              :key="result.id"
              class="p-3 border border-border rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
              @click="handleResultClick(result)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <h4 class="text-sm font-medium text-foreground truncate">
                    {{ result.title }}
                  </h4>
                  <p class="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {{ result.snippet }}
                  </p>
                  <div class="flex items-center gap-2 mt-2">
                    <Badge variant="outline" class="text-xs">
                      {{ result.source }}
                    </Badge>
                    <span class="text-xs text-muted-foreground truncate">
                      {{ result.url }}
                    </span>
                  </div>
                </div>

                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class="shrink-0 mt-1 text-muted-foreground"
                >
                  <path d="M7 17L17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </div>
            </div>
          </div>

          <div v-else-if="status === 'error'" class="text-center py-4 text-destructive text-sm">
            Failed to fetch search results
          </div>

          <div v-else class="text-center py-4 text-muted-foreground text-sm">No results found</div>
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
