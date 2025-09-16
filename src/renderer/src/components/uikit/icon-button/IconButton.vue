<script setup lang="ts">
import { Button } from '@/components/uikit/button'

type Props = {
  class?: string
}

withDefaults(defineProps<Props>(), {})
</script>

<template>
  <Button variant="ghost" size="icon" :class="['bg-transparent hover:bg-accent/50', $props.class]">
    <slot />
  </Button>
</template>
