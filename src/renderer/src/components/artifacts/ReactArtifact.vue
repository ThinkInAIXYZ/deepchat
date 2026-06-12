<template>
  <div class="flex h-full min-h-0 w-full overflow-hidden" data-testid="react-artifact-root">
    <iframe
      ref="iframeRef"
      :srcdoc="htmlContent"
      class="html-iframe-wrapper h-full min-h-0 w-full"
      sandbox="allow-scripts"
      data-testid="react-artifact-iframe"
    ></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { formatTemplate } from './ReactTemplate'

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
  isPreview: boolean
}>()

const iframeRef = ref<HTMLIFrameElement>()

onMounted(() => {
  if (props.isPreview && iframeRef.value) {
    const iframe = iframeRef.value
    iframe.onload = () => {}
  }
})
const htmlContent = computed(() => {
  return formatTemplate(props.block.artifact.title, props.block.content)
})
</script>
