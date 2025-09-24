<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <p
    data-slot="card-description"
    :class="cn('text-zinc-500 text-sm dark:text-zinc-400', props.class)"
  >
    <slot />
  </p>
</template>
