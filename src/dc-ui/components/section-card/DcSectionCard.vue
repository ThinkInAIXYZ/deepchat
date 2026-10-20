<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@shadcn/lib/utils'

interface Props {
  title?: string
  description?: string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <section :class="cn('rounded-xl border border-border bg-background px-5 py-4', props.class)">
    <header
      v-if="title || $slots.header || $slots.actions"
      class="mb-4 flex items-center justify-between gap-3"
    >
      <div class="min-w-0">
        <slot name="header">
          <h3 v-if="title" class="text-sm font-semibold text-foreground">{{ title }}</h3>
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
