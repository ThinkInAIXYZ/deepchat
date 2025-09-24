<script setup lang="ts">
import type { AccordionTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ChevronDown } from "lucide-vue-next"
import {
  AccordionHeader,
  AccordionTrigger,

} from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<AccordionTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <AccordionHeader class="flex">
    <AccordionTrigger
      data-slot="accordion-trigger"
      v-bind="delegatedProps"
      :class="
        cn(
          'focus-visible:border-zinc-950 focus-visible:ring-zinc-950/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180 dark:focus-visible:border-zinc-300 dark:focus-visible:ring-zinc-300/50',
          props.class,
        )
      "
    >
      <slot />
      <slot name="icon">
        <ChevronDown
          class="text-zinc-500 pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200 dark:text-zinc-400"
        />
      </slot>
    </AccordionTrigger>
  </AccordionHeader>
</template>
