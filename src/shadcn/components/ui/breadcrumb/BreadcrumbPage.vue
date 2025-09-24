<script lang="ts" setup>
import type { HTMLAttributes } from "vue"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="breadcrumb-page"
    role="link"
    aria-disabled="true"
    aria-current="page"
    :class="cn('text-zinc-950 font-normal dark:text-zinc-50', props.class)"
  >
    <slot />
  </span>
</template>
