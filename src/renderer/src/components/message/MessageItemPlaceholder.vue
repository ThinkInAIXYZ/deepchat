<template>
  <div
    :data-message-id="messageId"
    class="px-4 py-3"
    :style="height ? { height: `${height}px` } : undefined"
  >
    <div class="flex items-center gap-2 mb-2">
      <div class="h-4 w-4 rounded-sm bg-muted/60 animate-pulse" />
      <div class="h-3 w-24 rounded bg-muted/40 animate-pulse" />
    </div>
    <div class="space-y-2">
      <div class="h-3 w-full rounded bg-muted/40 animate-pulse" />
      <div class="h-3 w-5/6 rounded bg-muted/40 animate-pulse" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  messageId: string
  height?: number
}>()
</script>
