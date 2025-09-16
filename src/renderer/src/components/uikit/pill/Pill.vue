<script setup lang="ts">
// No props are required. Let Vue inherit attributes (like `class`, `dir`).
</script>

<template>
  <div
    class="inline-flex items-center gap-2 h-7 px-2 rounded-full border bg-muted/60 text-xs text-muted-foreground"
  >
    <slot />
  </div>
</template>
