<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="dropdown-menu-shortcut"
    :class="cn('text-zinc-500 ml-auto text-xs tracking-widest dark:text-zinc-400', props.class)"
  >
    <slot />
  </span>
</template>
