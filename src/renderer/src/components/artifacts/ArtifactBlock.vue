<template>
  <div 
    class="w-full rounded-lg border bg-card text-card-foreground shadow-sm hover:border-primary transition-colors cursor-pointer" 
    @click="handleExpand"
  >
    <div class="flex items-center p-4">
      <div class="mr-4 flex-shrink-0">
        <div class="w-12 h-12 flex items-center justify-center bg-muted rounded-md">
          <Icon :icon="artifactIcon" class="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
      <div class="flex-grow">
        <h3 class="text-lg font-semibold leading-none tracking-tight">
          {{ block.artifact?.title }}
        </h3>
        <p class="text-sm text-muted-foreground mt-1">
          Click to open document
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { ArtifactPreviewData } from '@/composables/useArtifactsPreview'

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
      language?: string
    }
    content: string
  }
}>()

// 生成内容图标
const artifactIcon = computed(() => {
  if (!props.block.artifact) return 'lucide:file'
  
  switch (props.block.artifact.type) {
    case 'application/vnd.ant.code':
      return 'lucide:code'
    case 'text/markdown':
      return 'lucide:file-text'
    case 'text/html':
      return 'lucide:globe'
    case 'image/svg+xml':
      return 'lucide:image'
    case 'application/vnd.ant.mermaid':
      return 'lucide:bar-chart'
    default:
      return 'lucide:file'
  }
})

const handleExpand = () => {
  if (window.openArtifactsPreview && props.block.artifact) {
    // 生成一个唯一标识符，用于判断是否是同一个artifact
    const artifactId = `${props.block.artifact.type}:${props.block.artifact.title}`
    
    // 调用全局方法，传入标识符，由App.vue决定是打开还是关闭
    const previewData: ArtifactPreviewData = {
      content: props.block.content,
      type: props.block.artifact.type,
      title: props.block.artifact.title,
      language: props.block.artifact.language,
      id: artifactId
    }
    
    window.openArtifactsPreview(previewData)
  }
}
</script>

<style scoped>
</style>
