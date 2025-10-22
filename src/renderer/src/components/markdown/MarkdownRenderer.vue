<!-- eslint-disable vue/no-v-html -->
<template>
  <div class="prose prose-zinc prose-sm dark:prose-invert w-full max-w-none break-all">
    <NodeRenderer :content="debouncedContent" @copy="$emit('copy', $event)" />
  </div>
</template>

<script setup lang="ts">
import { usePresenter } from '@/composables/usePresenter'
import { useArtifactStore } from '@/stores/artifact'
import { useReferenceStore } from '@/stores/reference'
import { nanoid } from 'nanoid'
import { useDebounceFn } from '@vueuse/core'
import { h, ref, watch } from 'vue'
import NodeRenderer, {
  CodeBlockNode,
  ReferenceNode,
  setCustomComponents,
  setKaTeXWorker,
  setMermaidWorker,
  getUseMonaco
} from 'vue-renderer-markdown'
import KatexWorker from 'vue-renderer-markdown/workers/katexRenderer.worker?worker&inline'
import MermaidWorker from 'vue-renderer-markdown/workers/mermaidParser.worker?worker&inline'

const props = defineProps<{
  content: string
  debug?: boolean
}>()
getUseMonaco()
setKaTeXWorker(new KatexWorker())
setMermaidWorker(new MermaidWorker())
// 组件映射表
const artifactStore = useArtifactStore()
// 生成唯一的 message ID 和 thread ID，用于 MarkdownRenderer
const messageId = `artifact-msg-${nanoid()}`
const threadId = `artifact-thread-${nanoid()}`
const referenceStore = useReferenceStore()
const threadPresenter = usePresenter('threadPresenter')
const referenceNode = ref<HTMLElement | null>(null)
const debouncedContent = ref(props.content)

const updateContent = useDebounceFn(
  (value: string) => {
    debouncedContent.value = value
  },
  32,
  { maxWait: 64 }
)

watch(
  () => props.content,
  (value) => {
    updateContent(value)
  }
)

setCustomComponents({
  reference: (_props) =>
    h(ReferenceNode, {
      ..._props,
      messageId,
      threadId,
      onClick() {
        threadPresenter.getSearchResults(_props.messageId ?? '').then((results) => {
          const index = parseInt(_props.node.id)
          if (index < results.length) {
            window.open(results[index - 1].url, '_blank', 'noopener,noreferrer')
          }
        })
      },
      onMouseEnter() {
        console.log('Mouse entered')
        referenceStore.hideReference()
        threadPresenter.getSearchResults(_props.messageId ?? '').then((results) => {
          const index = parseInt(_props.node.id)
          if (index - 1 < results.length && referenceNode.value) {
            referenceStore.showReference(
              results[index - 1],
              referenceNode.value.getBoundingClientRect()
            )
          }
        })
      },
      onMouseLeave() {
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
          threadId,
          { force: true }
        )
      }
    })
})

defineEmits(['copy'])
</script>

<style lang="css">
@reference '../../assets/style.css';

.prose {
  pre {
    margin-top: 0;
    margin-bottom: 0;
  }

  .mermaid-block-header img {
    margin: 0 !important;
  }

  p {
    @apply my-2;
  }

  li p {
    padding-top: 0;
    padding-bottom: 0;
    margin-top: 0;
    margin-bottom: 0;
  }
  h1 {
    @apply text-2xl font-bold my-3 py-0;
  }
  h2 {
    @apply text-xl font-medium my-3 py-0;
  }
  h3 {
    @apply text-base font-medium my-2 py-0;
  }
  h4 {
    @apply text-sm font-medium my-2 py-0;
  }
  h5 {
    @apply text-sm my-1.5 py-0;
  }
  h6 {
    @apply text-sm my-1.5 py-0;
  }

  ul,
  ol {
    @apply my-1.5;
  }

  hr {
    @apply my-8;
  }

  /*
    精准定位到那个被错误地渲染在 <a> 标签内部的 <div>，
    并强制其以行内方式显示，从而修正换行 bug。
    这可以保留链接组件原有的所有样式（包括颜色）。
  */
  a .markdown-renderer {
    display: inline;
  }

  .table-node-wrapper {
    @apply border border-border rounded-lg py-0 my-0 overflow-hidden shadow-sm;
  }

  table {
    @apply py-0 my-0;
    /* @apply bg-card border block rounded-lg my-0 py-0 overflow-hidden; */
    border-collapse: collapse;
  }

  thead,
  thead tr,
  thead th {
    @apply bg-muted;
  }

  th,
  td {
    @apply border-b not-last:border-r border-border;
  }

  tbody tr:last-child td {
    @apply border-b-0;
  }
}
</style>
