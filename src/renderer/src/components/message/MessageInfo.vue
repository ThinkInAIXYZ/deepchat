<template>
  <div class="flex flex-row items-center gap-2 h-4">
    <span class="text-xs font-bold text-foreground">{{ name }}</span>
    <span class="text-xs text-text-secondary-foreground">{{ formattedTime }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  timestamp: number
}>()

const formattedTime = computed(() => {
  if (!props.timestamp) {
    return ''
  }
  const date = new Date(props.timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
})
</script>
