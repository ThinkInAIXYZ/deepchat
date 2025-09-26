<!-- eslint-disable vue/no-v-html -->
<template>
  <div class="prose prose-sm dark:prose-invert w-full max-w-none break-all">
    <NodeRenderer
      :content="content"
      @copy="$emit('copy', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { usePresenter } from '@/composables/usePresenter';
import { useArtifactStore } from '@/stores/artifact';
import { useReferenceStore } from '@/stores/reference';
import { nanoid } from 'nanoid';
import { h, ref } from 'vue';
import NodeRenderer, { CodeBlockNode, ReferenceNode, setCustomComponents } from 'vue-renderer-markdown';

defineProps<{
  content: string
  debug?: boolean
}>()

// 组件映射表
const artifactStore = useArtifactStore()
// 生成唯一的 message ID 和 thread ID，用于 MarkdownRenderer
const messageId = `artifact-msg-${nanoid()}`
const threadId = `artifact-thread-${nanoid()}`
const referenceStore = useReferenceStore()
const threadPresenter = usePresenter('threadPresenter')
const referenceNode = ref<HTMLElement | null>(null)

setCustomComponents( {
  reference: (_props) =>
    h(ReferenceNode, {
      ..._props,
      messageId,
      threadId,
      onClick(){
        threadPresenter.getSearchResults(_props.messageId ?? '').then((results) => {
          const index = parseInt(_props.node.id)
          if (index < results.length) {
            window.open(results[index - 1].url, '_blank', 'noopener,noreferrer')
          }
        })
      },
      onMouseEnter(){
        console.log('Mouse entered')
        referenceStore.hideReference()
        threadPresenter.getSearchResults(_props.messageId ?? '').then((results) => {
          const index = parseInt(_props.node.id)
          if (index - 1 < results.length && referenceNode.value) {
            referenceStore.showReference(results[index - 1], referenceNode.value.getBoundingClientRect())
          }
        })
      },
      onMouseLeave(){
        console.log('Mouse left')
        referenceStore.hideReference()
      }
    }),
  code_block: (_props) =>
    h(CodeBlockNode, {
      ..._props,
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
})

defineEmits(['copy'])
</script>

<style lang="css">
.prose {
  pre {
    margin-top: 0;
    margin-bottom: 0;
  }
  .mermaid-block-header img {
    margin: 0 !important;
  }
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
