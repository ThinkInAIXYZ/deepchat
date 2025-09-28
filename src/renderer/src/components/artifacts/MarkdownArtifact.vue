<template>
  <div
    ref="messageBlock"
    class="markdown-content-wrapper relative w-full px-4 pb-8 artifact-dialog-content"
  >
    <MarkdownRenderer :content="props.block.content || ''" @copy="handleCopyClick" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'

const messageBlock = ref<HTMLDivElement>()

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
}>()

// 处理复制功能
const handleCopyClick = () => {
  // 复制功能现在在 MarkdownRenderer 内部处理
}
</script>

<style>
@reference '../../assets/style.css';

.markdown-content-wrapper {
  line-height: 1.75rem;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
