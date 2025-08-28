<!-- eslint-disable vue/no-v-html -->
<template>
  <div class="prose prose-sm dark:prose-invert w-full max-w-none break-all">
    <NodeRenderer
      :custom-components="nodeComponents"
      :content="content"
      @copy="$emit('copy', $event)"
      :typewriterEffect="true"
    />
  </div>
</template>

<script setup lang="ts">
import NodeRenderer, { CodeBlockNode } from 'vue-renderer-markdown'
import ReferenceNode from './ReferenceNode.vue'
import { h } from 'vue'
import { useArtifactStore } from '@/stores/artifact'
import { nanoid } from 'nanoid'

defineProps<{
  content: string
  debug?: boolean
}>()

// 组件映射表
const artifactStore = useArtifactStore()
// 生成唯一的 message ID 和 thread ID，用于 MarkdownRenderer
const messageId = `artifact-msg-${nanoid()}`
const threadId = `artifact-thread-${nanoid()}`
const nodeComponents = {
  reference: ReferenceNode,
  code_block: (_props) =>
    h(CodeBlockNode, {
      ..._props,
      // todo: 配置 custom themes
      // darkTheme
      // lightTheme
      onPreviewCode(v) {
        artifactStore.showArtifact(
          {
            id: v.id,
            type: v.artifactType,
            title: v.artifactTitle,
            language: v.language,
            content: v.node.code,
            status: 'loaded'
          },
          messageId,
          threadId
        )
      }
    })
}

defineEmits(['copy'])
</script>

<style>
.prose {
  li p {
    @apply py-0 my-0;
  }

  hr {
    margin-block-start: 0.5em;
    margin-block-end: 0.5em;
    margin-inline-start: auto;
    margin-inline-end: auto;
  }

  /*
    精准定位到那个被错误地渲染在 <a> 标签内部的 <div>，
    并强制其以行内方式显示，从而修正换行 bug。
    这可以保留链接组件原有的所有样式（包括颜色）。
  */
  a .markdown-renderer {
    @apply inline;
  }
}
</style>
