<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { Button, type ButtonVariants } from '@shadcn/components/ui/button'

const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      class?: HTMLAttributes['class']
      variant?: ButtonVariants['variant']
      size?: ButtonVariants['size']
    }
  >(),
  {
    as: 'button'
  }
)
</script>

<template>
  <Button
    data-slot="alert-dialog-async-action"
    :as="as"
    :as-child="asChild"
    :variant="variant"
    :size="size"
    :type="!asChild && as === 'button' ? 'button' : undefined"
    :class="props.class"
  >
    <slot />
  </Button>
</template>
