<template>
  <div class="w-full h-full overflow-auto">
    <iframe
      ref="iframeRef"
      :srcdoc="htmlContent"
      class="w-full h-full min-h-[400px] html-iframe-wrapper"
      sandbox="allow-scripts"
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
