<template>
  <div class="text-xs text-secondary-foreground bg-muted rounded-lg border border-input flex flex-col gap-2 px-2 py-2">
    <div class="flex flex-row gap-2 items-center cursor-pointer" @click="$emit('toggle')">
      <span class="flex-grow">{{ label }}</span>
      <Icon v-if="thinking && !expanded" icon="lucide:ellipsis" class="w-4 h-4 text-muted-foreground animate-pulse" />
      <Icon v-else-if="expanded" icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
      <Icon v-else icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
    </div>

    <div v-show="expanded" class="w-full relative">
      <div class="prose prose-sm dark:prose-invert w-full max-w-full leading-7 break-all" v-html="contentHtml"></div>
    </div>

    <Icon v-if="thinking && expanded" icon="lucide:ellipsis" class="w-4 h-4 text-muted-foreground animate-pulse" />
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'

defineProps<{
  label: string
  expanded: boolean
  thinking: boolean
  contentHtml?: string
}>()

defineEmits<{
  (e: 'toggle'): void
}>()
</script>


