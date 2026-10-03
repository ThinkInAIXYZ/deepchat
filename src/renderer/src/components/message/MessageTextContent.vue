<template>
  <div class="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
    {{ content }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>
