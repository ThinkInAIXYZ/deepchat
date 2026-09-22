<template>
  <div class="min-w-0 overflow-hidden rounded-md border">
    <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
      <span class="min-w-0 truncate text-sm font-medium">{{ block.artifact.title }}</span>
      <DcCopyButton :copy-text="block.content" />
    </div>
    <pre
      class="dc-overscroll-contain overflow-auto p-3 text-xs leading-6"
    ><code>{{ block.content }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { DcCopyButton } from '@dc-ui/components'

defineProps<{
  block: {
    content: string
    artifact: { title: string }
  }
}>()
</script>
