<template>
  <div class="text-sm whitespace-pre-wrap break-all">
    {{ content }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>
