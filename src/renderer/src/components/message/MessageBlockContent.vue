<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<template>
  <div ref="messageBlock" class="markdown-content-wrapper relative w-full">
    <template v-for="(part, index) in processedContent" :key="index">
      <!-- 使用结构化渲染器替代 v-html -->
      <MarkdownRenderer
        v-if="part.type === 'text'"
        :content="part.content"
        :loading="part.loading"
        @copy="handleCopyClick"
      />

      <ArtifactThinking v-else-if="part.type === 'thinking' && part.loading" />
      <div v-else-if="part.type === 'artifact' && part.artifact" class="my-1">
        <ArtifactPreview
          :block="{
            content: part.content,
            artifact: part.artifact
          }"
          :message-id="messageId"
          :thread-id="threadId"
          :loading="part.loading"
        />
      </div>
      <div v-else-if="part.type === 'tool_call' && part.tool_call" class="my-1">
        <ToolCallPreview :block="part" :block-status="props.block.status" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'

import { usePresenter } from '@/composables/usePresenter'
import { SearchResult } from '@shared/presenter'

const threadPresenter = usePresenter('threadPresenter')
const searchResults = ref<SearchResult[]>([])

import ArtifactThinking from '../artifacts/ArtifactThinking.vue'
import ArtifactPreview from '../artifacts/ArtifactPreview.vue'
import ToolCallPreview from '../artifacts/ToolCallPreview.vue'
import { useBlockContent } from '@/composables/useArtifacts'
import { useArtifactStore } from '@/stores/artifact'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import { AssistantMessageBlock } from '@shared/chat'
const artifactStore = useArtifactStore()
const props = defineProps<{
  block: AssistantMessageBlock
  messageId: string
  threadId: string
  isSearchResult?: boolean
}>()

const messageBlock = ref<HTMLDivElement>()

const { processedContent } = useBlockContent(props)

// Handle copy functionality
const handleCopyClick = () => {
  // 现在复制功能在组件内部处理
}

// 修改 watch 函数
watch(
  processedContent,
  () => {
    nextTick(() => {
      for (const part of processedContent.value) {
        if (part.type === 'artifact' && part.artifact) {
          if (props.block.status === 'loading') {
            if (artifactStore.currentArtifact?.id === part.artifact.identifier) {
              // Use updateArtifactContent to trigger reactivity
              artifactStore.updateArtifactContent({
                content: part.content,
                title: part.artifact.title,
                type: part.artifact.type,
                status: part.loading ? 'loading' : 'loaded'
              })
            } else {
              artifactStore.showArtifact(
                {
                  id: part.artifact.identifier,
                  type: part.artifact.type,
                  title: part.artifact.title,
                  language: part.artifact.language,
                  content: part.content,
                  status: part.loading ? 'loading' : 'loaded'
                },
                props.messageId,
                props.threadId
              )
            }
          } else {
            if (artifactStore.currentArtifact?.id === part.artifact.identifier) {
              // Use updateArtifactContent to trigger reactivity
              artifactStore.updateArtifactContent({
                content: part.content,
                title: part.artifact.title,
                type: part.artifact.type,
                status: 'loaded'
              })
            }
          }
        }
      }
    })
  },
  { immediate: true }
)

onMounted(async () => {
  if (props.isSearchResult) {
    searchResults.value = await threadPresenter.getSearchResults(props.messageId)
  }
})
</script>
