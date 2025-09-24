<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@shadcn/lib/utils'
import { Input } from '@shadcn/components/ui/input'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Input
    data-slot="sidebar-input"
    data-sidebar="input"
    :class="cn(
      'bg-white h-8 w-full shadow-none dark:bg-zinc-950',
      props.class,
    )"
  >
    <slot />
  </Input>
</template>
