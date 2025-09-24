<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  SwitchRoot,

  SwitchThumb,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<SwitchRootProps & { class?: HTMLAttributes["class"] }>()

const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SwitchRoot
    data-slot="switch"
    v-bind="forwarded"
    :class="cn(
      'peer data-[state=checked]:bg-zinc-900 data-[state=unchecked]:bg-zinc-200 focus-visible:border-zinc-950 focus-visible:ring-zinc-950/50 dark:data-[state=unchecked]:bg-zinc-200/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-zinc-200 border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:data-[state=checked]:bg-zinc-50 dark:data-[state=unchecked]:bg-zinc-800 dark:focus-visible:border-zinc-300 dark:focus-visible:ring-zinc-300/50 dark:dark:data-[state=unchecked]:bg-zinc-800/80 dark:border-zinc-800',
      props.class,
    )"
  >
    <SwitchThumb
      data-slot="switch-thumb"
      :class="cn('bg-white dark:data-[state=unchecked]:bg-zinc-950 dark:data-[state=checked]:bg-zinc-50 pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:bg-zinc-950 dark:dark:data-[state=unchecked]:bg-zinc-50 dark:dark:data-[state=checked]:bg-zinc-900')"
    >
      <slot name="thumb" />
    </SwitchThumb>
  </SwitchRoot>
</template>
