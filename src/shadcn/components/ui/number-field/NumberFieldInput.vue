<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { NumberFieldInput } from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <NumberFieldInput
    data-slot="input"
    :class="cn('flex h-9 w-full rounded-md border border-zinc-200 bg-transparent py-1 text-sm text-center shadow-sm transition-colors placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:placeholder:text-zinc-400 dark:focus-visible:ring-zinc-300', props.class)"
  />
</template>
