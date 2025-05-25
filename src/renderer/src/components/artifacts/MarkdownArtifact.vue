<template>
  <div ref="messageBlock" class="markdown-content-wrapper relative w-full px-4 pb-8 artifact-dialog-content">
    <MarkdownRenderer
      :content="props.block.content || ''"
      :message-id="generateMessageId()"
      :thread-id="generateThreadId()"
      @copy="handleCopyClick"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { nanoid } from 'nanoid'
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

// 生成唯一的 message ID 和 thread ID，用于 MarkdownRenderer
const generateMessageId = () => `artifact-msg-${nanoid()}`
const generateThreadId = () => `artifact-thread-${nanoid()}`

// 处理复制功能
const handleCopyClick = () => {
  // 复制功能现在在 MarkdownRenderer 内部处理
}
</script>

<style>
.markdown-content-wrapper {
  @apply leading-7;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
