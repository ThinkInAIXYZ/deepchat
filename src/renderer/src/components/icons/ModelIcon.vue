<script setup lang="ts">
import { computed } from 'vue'
import { getModelIcon } from '@/composables/useModelIcons'

interface Props {
  modelId: string
  customClass?: string
  isDark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  customClass: 'w-4 h-4',
  isDark: false
})

const iconUrl = computed(() => {
  return getModelIcon(props.modelId)
})

const invert = computed(() => {
  if (!props.isDark) {
    return false
  }
  if (
    props.modelId.toLowerCase() === 'openai' ||
    props.modelId.toLowerCase().includes('openai-responses') ||
    props.modelId.toLowerCase().includes('openrouter') ||
    props.modelId.toLowerCase().includes('ollama') ||
    props.modelId.toLowerCase().includes('grok') ||
    props.modelId.toLowerCase().includes('groq') ||
    props.modelId.toLowerCase().includes('github') ||
    props.modelId.toLowerCase().includes('moonshot') ||
    props.modelId.toLowerCase().includes('lmstudio') ||
    props.modelId.toLowerCase().includes('aws-bedrock')
  ) {
    return true
  }
  return false
})
</script>

<template>
  <img
    :src="iconUrl"
    :alt="modelId"
    :class="[customClass, { invert }, invert ? 'opacity-50' : '']"
  />
</template>

<style scoped>
.invert {
  filter: invert(1);
}
</style>
