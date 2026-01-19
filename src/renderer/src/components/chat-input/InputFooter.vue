<template>
  <div class="flex items-center justify-between px-3 pb-2 pt-2">
    <!-- Left: Mode Selector -->
    <div class="flex items-center gap-2">
      <slot name="left-area"></slot>
    </div>

    <!-- Right: Model Selector + Config Button -->
    <div class="flex items-center gap-2">
      <slot name="right-area"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure layout component, no logic needed
</script>
