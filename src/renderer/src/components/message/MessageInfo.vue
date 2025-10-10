<template>
  <div class="flex flex-row items-center gap-2 min-h-5">
    <span class="text-xs font-bold text-foreground">{{ name }}</span>
    <span
      class="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
      >{{ formattedTime }}</span
    >
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
