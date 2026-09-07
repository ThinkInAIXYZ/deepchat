<script setup lang="ts">
import { Skeleton } from '@shadcn/components/ui/skeleton'
</script>

<template>
  <div
    data-testid="generation-parameter-loading"
    class="min-h-[5.25rem] space-y-3"
    aria-hidden="true"
  >
    <div class="flex items-center justify-between gap-3">
      <Skeleton class="h-4 w-24" />
      <Skeleton class="h-4 w-10" />
    </div>
    <Skeleton class="h-9 w-full" />
    <Skeleton class="h-3 w-2/3" />
  </div>
</template>
