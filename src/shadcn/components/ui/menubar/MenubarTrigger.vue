<script setup lang="ts">
import type { MenubarTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { MenubarTrigger, useForwardProps } from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<MenubarTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MenubarTrigger
    data-slot="menubar-trigger"
    v-bind="forwardedProps"
    :class="
      cn(
        'focus:bg-zinc-100 focus:text-zinc-900 data-[state=open]:bg-zinc-100 data-[state=open]:text-zinc-900 flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-hidden select-none dark:focus:bg-zinc-800 dark:focus:text-zinc-50 dark:data-[state=open]:bg-zinc-800 dark:data-[state=open]:text-zinc-50',
        props.class,
      )
    "
  >
    <slot />
  </MenubarTrigger>
</template>
