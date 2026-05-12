<template>
  <ScrollArea class="h-full w-full">
    <main
      :data-testid="dataTestid"
      class="mx-auto flex min-h-full w-full max-w-7xl min-w-0 flex-col gap-4 p-4 lg:p-6"
    >
      <header class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <div v-if="eyebrow" class="text-xs font-medium text-muted-foreground">
            {{ eyebrow }}
          </div>
          <h1 class="truncate text-xl font-semibold text-foreground">
            {{ title }}
          </h1>
          <p v-if="description" class="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {{ description }}
          </p>
        </div>
        <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
          <slot name="actions" />
        </div>
      </header>

      <slot />
    </main>
  </ScrollArea>
</template>

<script setup lang="ts">
import { ScrollArea } from '@shadcn/components/ui/scroll-area'

defineProps<{
  title: string
  description?: string
  eyebrow?: string
  dataTestid?: string
}>()
</script>
