<template>
  <div class="svg-artifact artifact-dialog-content" v-html="sanitizedContent"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
}>()

const sanitizedContent = computed(() => {
  if (!props.block.content) return ''
  return props.block.content
})
</script>

<style>
.svg-artifact {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
}

.svg-artifact svg {
  max-width: 100%;
  height: auto;
}
</style>
