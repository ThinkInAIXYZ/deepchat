<script setup lang="ts">
import type { ProgressRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  ProgressIndicator,
  ProgressRoot,

} from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = withDefaults(
  defineProps<ProgressRootProps & { class?: HTMLAttributes["class"] }>(),
  {
    modelValue: 0,
  },
)

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegatedProps"
    :class="
      cn(
        'bg-zinc-900/20 relative h-2 w-full overflow-hidden rounded-full dark:bg-zinc-50/20',
        props.class,
      )
    "
  >
    <ProgressIndicator
      data-slot="progress-indicator"
      class="bg-zinc-900 h-full w-full flex-1 transition-all dark:bg-zinc-50"
      :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%);`"
    />
  </ProgressRoot>
</template>
