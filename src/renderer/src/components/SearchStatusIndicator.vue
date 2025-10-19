<template>
  <div
    :class="[
      'min-h-7 py-1.5 flex items-center gap-2 px-2 rounded-lg border text-xs leading-4 transition-colors duration-150',
      containerClasses,
      interactive
        ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-accent'
        : 'cursor-default'
    ]"
  >
    <div class="flex items-center gap-1.5 min-w-0">
      <Icon :icon="iconName" :class="['w-3.5 h-3.5 shrink-0', iconClass]" />
      <span class="font-mono font-medium tracking-tight text-foreground/80 truncate leading-none">
        {{ label }}
      </span>
    </div>
    <div class="flex items-center gap-2 text-muted-foreground min-w-0">
      <span class="opacity-50">-</span>
      <span class="truncate">{{ description }}</span>
    </div>
    <div v-if="showFavicons" class="flex items-center pl-2">
      <div v-for="(iconSrc, index) in faviconList" :key="index" class="relative">
        <img
          v-if="iconSrc"
          :src="iconSrc"
          class="w-4 h-4 rounded-full border border-background object-cover -ml-2 first:ml-0 shadow-sm bg-card"
          alt=""
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    status:
      | 'success'
      | 'loading'
      | 'error'
      | 'optimizing'
      | 'reading'
      | 'cancel'
      | 'pending'
      | 'granted'
      | 'denied'
    label?: string
    description: string
    favicons?: string[]
    interactive?: boolean
  }>(),
  {
    label: 'web_search',
    favicons: () => [],
    interactive: false
  }
)

const statusVariant = computed(() => {
  if (props.status === 'error' || props.status === 'denied') return 'error'
  if (props.status === 'success' || props.status === 'granted') return 'success'
  if (props.status === 'cancel') return 'neutral'
  return 'running'
})

const containerClasses = computed(() => {
  switch (statusVariant.value) {
    case 'error':
      return 'border-destructive/40 bg-destructive/5 text-destructive'
    case 'success':
      return 'border-border/50 bg-muted  text-muted-foreground'
    case 'neutral':
      return 'border-border/40 bg-muted text-muted-foreground'
    default:
      return 'border-border/40 bg-muted text-foreground'
  }
})

const iconName = computed(() => {
  switch (statusVariant.value) {
    case 'error':
      return 'lucide:x'
    case 'success':
    case 'neutral':
      return 'lucide:circle-small'
    default:
      return 'lucide:circle-small'
  }
})

const iconClass = computed(() => {
  switch (statusVariant.value) {
    case 'error':
      return 'text-destructive'
    case 'success':
      return 'text-emerald-500'
    case 'neutral':
      return 'text-muted-foreground/80'
    default:
      return 'text-emerald-500'
  }
})

const faviconList = computed(() => props.favicons.slice(0, 6))
const showFavicons = computed(() => faviconList.value.length > 0)
</script>
