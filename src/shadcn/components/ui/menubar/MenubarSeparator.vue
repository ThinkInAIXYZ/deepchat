<script setup lang="ts">
import type { MenubarSeparatorProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { MenubarSeparator, useForwardProps } from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<MenubarSeparatorProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MenubarSeparator
    data-slot="menubar-separator"
    :class=" cn('bg-zinc-200 -mx-1 my-1 h-px dark:bg-zinc-800', props.class)"
    v-bind="forwardedProps"
  />
</template>
