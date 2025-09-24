<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@shadcn/lib/utils'

interface SkeletonProps {
  class?: HTMLAttributes["class"]
}

const props = defineProps<SkeletonProps>()
</script>

<template>
  <div
    data-slot="skeleton"
    :class="cn('animate-pulse rounded-md bg-zinc-900/10 dark:bg-zinc-50/10', props.class)"
  />
</template>
