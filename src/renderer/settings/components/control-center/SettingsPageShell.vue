<template>
  <ScrollArea class="h-full w-full">
    <section
      :data-testid="dataTestid"
      class="mx-auto flex min-h-full w-full max-w-5xl min-w-0 flex-col gap-8 px-5 py-8 lg:px-10 lg:py-10"
    >
      <header
        :class="[
          'flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
          stickyHeader
            ? 'sticky top-0 z-[var(--dc-z-sticky)] border-b border-border bg-background py-3'
            : ''
        ]"
      >
        <div class="min-w-0">
          <div v-if="eyebrow" class="mb-2 text-xs text-muted-foreground">
            {{ eyebrow }}
          </div>
          <h1 class="text-2xl font-semibold text-foreground">
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
    </section>
  </ScrollArea>
</template>

<script setup lang="ts">
import { ScrollArea } from '@shadcn/components/ui/scroll-area'

defineProps<{
  title: string
  description?: string
  eyebrow?: string
  dataTestid?: string
  stickyHeader?: boolean
}>()
</script>
