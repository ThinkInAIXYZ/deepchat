<script setup lang="ts">
type Props = {
  class?: string
}
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <div
    :class="[
      'inline-flex items-center gap-2 h-7 px-2 rounded-full border bg-muted/60 text-xs text-muted-foreground',
      $props.class
    ]"
  >
    <slot />
  </div>
</template>
