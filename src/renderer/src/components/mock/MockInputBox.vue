<template>
  <div
    class="w-full max-w-2xl rounded-xl border bg-card/30 backdrop-blur-lg shadow-sm overflow-hidden"
  >
    <Textarea
      placeholder="Ask DeepChat anything, @ to mention files, / for commands"
      class="min-h-[80px] resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:border-0 bg-transparent! dark:bg-transparent placeholder:text-muted-foreground px-4 pt-4 pb-2 text-sm"
      :model-value="''"
    />

    <slot name="toolbar" />
  </div>
</template>

<script setup lang="ts">
import { Textarea } from '@shadcn/components/ui/textarea'
</script>
