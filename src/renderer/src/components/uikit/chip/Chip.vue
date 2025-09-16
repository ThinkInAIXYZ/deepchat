<script setup lang="ts">
type Props = {
  class?: string
}
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <div
    :class="[
      'inline-flex items-center gap-2 h-7 px-2 rounded-lg border text-xs text-foreground/80 bg-background/80',
      'hover:bg-accent/50 transition-colors',
      $props.class
    ]"
  >
    <slot />
  </div>
</template>
