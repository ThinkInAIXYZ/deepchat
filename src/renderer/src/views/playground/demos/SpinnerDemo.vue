<template>
  <div class="space-y-4">
    <div
      class="flex items-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 p-4"
    >
      <Spinner class="text-primary" />
      <div>
        <p class="text-sm font-medium">Syncing integrations</p>
        <p class="text-xs text-muted-foreground">We’ll notify you once everything is connected.</p>
      </div>
    </div>

    <div class="flex items-center gap-4">
      <Spinner class="size-3 text-muted-foreground" />
      <Spinner class="size-4 text-primary" />
      <Spinner class="size-6 text-emerald-500" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Spinner } from '@shadcn/components/ui/spinner'
</script>
