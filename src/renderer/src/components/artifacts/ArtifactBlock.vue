<template>
  <div class="w-full rounded-lg border shadow-sm">
    <div class="flex flex-col space-y-1.5 p-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold leading-none tracking-tight">
          {{ block.artifact?.title }}
        </h3>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="icon" @click="handleCopy">
            <Icon icon="lucide:copy" class="h-4 w-4" />
          </Button>
        </div>
      </div>
      <component
        :is="artifactComponent"
        v-if="artifactComponent"
        :block="block"
        :class="['mt-4', artifactClass]"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import CodeArtifact from './CodeArtifact.vue'
import MarkdownArtifact from './MarkdownArtifact.vue'
import HTMLArtifact from './HTMLArtifact.vue'
import SvgArtifact from './SvgArtifact.vue'
import MermaidArtifact from './MermaidArtifact.vue'
import ReactArtifact from './ReactArtifact.vue'

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
}>()

const artifactComponent = computed(() => {
  if (!props.block.artifact) return null
  switch (props.block.artifact.type) {
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
    case 'application/vnd.ant.react':
      return ReactArtifact
    default:
      return null
  }
})

const artifactClass = computed(() => {
  if (!props.block.artifact) return ''
  switch (props.block.artifact.type) {
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
    case 'application/vnd.ant.react':
      return ''
    default:
      return ''
  }
})

const handleCopy = () => {
  if (props.block.content) {
    window.api.copyText(props.block.content)
  }
}
</script>
