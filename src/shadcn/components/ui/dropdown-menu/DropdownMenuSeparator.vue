<script setup lang="ts">
import type { DropdownMenuSeparatorProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DropdownMenuSeparator,

} from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<DropdownMenuSeparatorProps & {
  class?: HTMLAttributes["class"]
}>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <DropdownMenuSeparator
    data-slot="dropdown-menu-separator"
    v-bind="delegatedProps"
    :class="cn('bg-zinc-200 -mx-1 my-1 h-px dark:bg-zinc-800', props.class)"
  />
</template>
