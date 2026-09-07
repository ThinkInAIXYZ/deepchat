<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@shadcn/lib/utils'

interface Props {
  title?: string
  description?: string
  class?: HTMLAttributes['class']
}

defineProps<Props>()
</script>

<template>
  <section :class="cn('rounded-lg border border-border bg-card/30 px-4 py-4', $attrs.class ?? '')">
    <header
      v-if="title || $slots.header || $slots.actions"
      class="mb-4 flex items-center justify-between gap-3"
    >
      <div class="min-w-0">
        <slot name="header">
          <h3 v-if="title" class="text-sm font-bold text-foreground">{{ title }}</h3>
          <p v-if="description" class="mt-0.5 text-xs leading-5 text-muted-foreground">
            {{ description }}
          </p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>
