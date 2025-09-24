<script setup lang="ts">
import type { MenubarSubContentEmits, MenubarSubContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  MenubarPortal,
  MenubarSubContent,

  useForwardPropsEmits,
} from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<MenubarSubContentProps & { class?: HTMLAttributes["class"] }>()
const emits = defineEmits<MenubarSubContentEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <MenubarPortal>
    <MenubarSubContent
      data-slot="menubar-sub-content"
      v-bind="forwarded"
      :class="
        cn(
          'bg-white text-zinc-950 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--reka-menubar-content-transform-origin) overflow-hidden rounded-md border border-zinc-200 p-1 shadow-lg dark:bg-zinc-950 dark:text-zinc-50 dark:border-zinc-800',
          props.class,
        )
      "
    >
      <slot />
    </MenubarSubContent>
  </MenubarPortal>
</template>
