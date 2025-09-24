<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Button } from '@shadcn/components/ui/button'

type Props = {
  class?: HTMLAttributes['class']
}

withDefaults(defineProps<Props>(), {})
</script>

<template>
  <Button
    variant="default"
    size="icon"
    :class="['bg-transparent hover:bg-accent/50', $props.class]"
  >
    <slot />
  </Button>
</template>
