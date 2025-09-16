<script setup lang="ts">
type Props = { class?: string }
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <div :class="['flex items-center h-10 gap-1 overflow-hidden', $props.class]">
    <slot />
  </div>
</template>
