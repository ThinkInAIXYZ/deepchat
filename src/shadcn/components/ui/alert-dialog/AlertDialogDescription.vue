<script setup lang="ts">
import type { AlertDialogDescriptionProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  AlertDialogDescription,

} from "reka-ui"
import { cn } from '@shadcn/lib/utils'

const props = defineProps<AlertDialogDescriptionProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <AlertDialogDescription
    data-slot="alert-dialog-description"
    v-bind="delegatedProps"
    :class="cn('text-zinc-500 text-sm dark:text-zinc-400', props.class)"
  >
    <slot />
  </AlertDialogDescription>
</template>
