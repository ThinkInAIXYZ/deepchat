<template>
  <div class="flex flex-col h-full" @click.stop>
    <!-- 头部 -->
    <div class="flex items-center justify-between p-4 border-b border-border">
      <h3 class="text-lg font-semibold leading-none tracking-tight">
        {{ artifact?.title || '预览' }}
      </h3>
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="icon" @click.stop="handleCopy" v-if="artifact">
          <Icon icon="lucide:copy" class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" @click.stop="$emit('close')">
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>
    </div>
    
    <!-- 内容区域 -->
    <div class="p-4 overflow-auto flex-1" @click="handleContentClick">
      <component
        :is="artifactComponent"
        v-if="artifactComponent && artifact"
        :block="{
          content: artifact.content,
          artifact: {
            type: artifact.type,
            title: artifact.title,
            language: artifact.language
          }
        }"
        :class="['mt-4', artifactClass]"
      />
      <div v-else class="flex items-center justify-center h-full text-muted-foreground">
        <p>无内容可预览</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import CodeArtifact from './CodeArtifact.vue'
import MarkdownArtifact from './MarkdownArtifact.vue'
import HTMLArtifact from './HTMLArtifact.vue'
import SvgArtifact from './SvgArtifact.vue'
import MermaidArtifact from './MermaidArtifact.vue'

const props = defineProps<{
  artifact: {
    content: string
    type: string
    title: string
    language?: string
  } | null
}>()

defineEmits(['close'])

const artifactComponent = computed(() => {
  if (!props.artifact) return null
  switch (props.artifact.type) {
    case 'application/vnd.ant.code':
      return CodeArtifact
    case 'text/markdown':
      return MarkdownArtifact
    case 'text/html':
      return HTMLArtifact
    case 'image/svg+xml':
      return SvgArtifact
    case 'application/vnd.ant.mermaid':
      return MermaidArtifact
    default:
      return null
  }
})

const artifactClass = computed(() => {
  if (!props.artifact) return ''
  switch (props.artifact.type) {
    case 'application/vnd.ant.code':
      return 'prose dark:prose-invert max-w-none'
    case 'text/markdown':
      return 'prose dark:prose-invert max-w-none'
    case 'text/html':
      return ''
    case 'image/svg+xml':
      return ''
    case 'application/vnd.ant.mermaid':
      return ''
    default:
      return ''
  }
})

const handleCopy = () => {
  if (props.artifact?.content) {
    window.api.copyText(props.artifact.content)
  }
}

// 处理内容区域点击
const handleContentClick = (event) => {
  // 阻止点击事件冒泡，防止点击内容区域关闭预览
  event.stopPropagation()
}
</script> 