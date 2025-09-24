<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'bg-white text-zinc-950 flex flex-col gap-6 rounded-xl border border-zinc-200 py-6 shadow-sm dark:bg-zinc-950 dark:text-zinc-50 dark:border-zinc-800',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
