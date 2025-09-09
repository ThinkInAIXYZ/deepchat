<script setup lang="ts">
import { computed, provide, ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { BaseComponentProps } from '../types'

interface Tab {
  id: string
  label: string
  disabled?: boolean
  closable?: boolean
  badge?: string | number
}

interface Props extends BaseComponentProps {
  tabs: Tab[]
  activeTab?: string
  variant?: 'default' | 'pills' | 'underline'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default'
})

const emit = defineEmits<{
  tabChange: [tabId: string]
  tabClose: [tabId: string]
}>()

const activeTabId = ref(props.activeTab || props.tabs[0]?.id)

// Provide active tab to children
provide('activeTab', activeTabId)

const containerClasses = computed(() => 
  cn(
    'w-full',
    props.class
  )
)

const tabsListClasses = computed(() => 
  cn(
    'flex items-center gap-1',
    {
      'border-b border-border': props.variant === 'default' || props.variant === 'underline',
      'bg-muted rounded-lg p-1': props.variant === 'pills'
    }
  )
)

const getTabClasses = (tab: Tab) => 
  cn(
    'flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    {
      // Default variant
      'border-b-2 border-transparent hover:text-foreground': 
        props.variant === 'default',
      'border-primary text-primary': 
        props.variant === 'default' && activeTabId.value === tab.id,
      'text-muted-foreground': 
        props.variant === 'default' && activeTabId.value !== tab.id,

      // Pills variant  
      'rounded-md hover:bg-background/60': 
        props.variant === 'pills',
      'bg-background text-foreground shadow-sm': 
        props.variant === 'pills' && activeTabId.value === tab.id,
      'text-muted-foreground hover:text-foreground': 
        props.variant === 'pills' && activeTabId.value !== tab.id,

      // Underline variant
      'border-b-2 border-transparent hover:border-border': 
        props.variant === 'underline',
      'border-primary text-foreground': 
        props.variant === 'underline' && activeTabId.value === tab.id,
      'text-muted-foreground hover:text-foreground transition-colors': 
        props.variant === 'underline' && activeTabId.value !== tab.id,

      // Disabled state
      'pointer-events-none opacity-50': tab.disabled
    }
  )

const handleTabClick = (tab: Tab) => {
  if (tab.disabled) return
  
  activeTabId.value = tab.id
  emit('tabChange', tab.id)
}

const handleTabClose = (tab: Tab, event: Event) => {
  event.stopPropagation()
  emit('tabClose', tab.id)
}
</script>

<template>
  <div :class="containerClasses">
    <!-- Tab List -->
    <div :class="tabsListClasses" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="getTabClasses(tab)"
        :aria-selected="activeTabId === tab.id"
        :disabled="tab.disabled"
        role="tab"
        type="button"
        @click="handleTabClick(tab)"
      >
        <span>{{ tab.label }}</span>
        
        <!-- Badge -->
        <span
          v-if="tab.badge"
          class="ml-1 px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded-full"
        >
          {{ tab.badge }}
        </span>

        <!-- Close Button -->
        <button
          v-if="tab.closable"
          type="button"
          class="ml-1 p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
          @click="handleTabClose(tab, $event)"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="12" 
            height="12" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2"
          >
            <path d="m18 6-12 12"/>
            <path d="m6 6 12 12"/>
          </svg>
        </button>
      </button>
    </div>

    <!-- Tab Content -->
    <div class="mt-4">
      <slot :activeTab="activeTabId" />
    </div>
  </div>
</template>