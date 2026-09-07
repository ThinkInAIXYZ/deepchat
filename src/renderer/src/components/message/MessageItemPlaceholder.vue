<template>
  <div
    :data-message-id="messageId"
    class="px-4 py-3"
    :style="height ? { height: `${height}px` } : undefined"
  >
    <div class="mb-2 flex items-center gap-2">
      <Skeleton class="size-4 rounded-sm bg-muted/60" />
      <Skeleton class="h-3 w-24 bg-muted/40" />
    </div>
    <div class="flex flex-col gap-2">
      <Skeleton class="h-3 w-full bg-muted/40" />
      <Skeleton class="h-3 w-5/6 bg-muted/40" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Skeleton } from '@shadcn/components/ui/skeleton'

defineProps<{
  messageId: string
  height?: number
}>()
</script>
