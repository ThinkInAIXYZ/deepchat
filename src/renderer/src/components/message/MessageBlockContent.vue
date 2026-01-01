<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<template>
  <template v-for="(part, index) in processedContent" :key="index">
    <!-- 使用结构化渲染器替代 v-html -->
    <MarkdownRenderer v-if="part.type === 'text'" :content="part.content" :loading="part.loading" />

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
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'

import { usePresenter } from '@/composables/usePresenter'
import { SearchResult } from '@shared/presenter'

const threadPresenter = usePresenter('agentPresenter')
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

const { processedContent } = useBlockContent(props)

// 修改 watch 函数
watch(
  processedContent,
  () => {
    nextTick(() => {
      for (const part of processedContent.value) {
        const artifact = part.type === 'artifact' && part.artifact
        if (!artifact) continue
        const { title, type } = artifact
        const { content, loading } = part
        if (props.block.status === 'loading') {
          const status = loading ? 'loading' : 'loaded'
          if (artifactStore.currentArtifact?.id === artifact.identifier) {
            // Use updateArtifactContent to trigger reactivity
            artifactStore.updateArtifactContent({
              content,
              title,
              type,
              status
            })
          } else {
            artifactStore.showArtifact(
              {
                id: artifact.identifier,
                type,
                title,
                language: artifact.language,
                content,
                status
              },
              props.messageId,
              props.threadId
            )
          }
        } else {
          if (artifactStore.currentArtifact?.id === artifact.identifier) {
            // Use updateArtifactContent to trigger reactivity
            artifactStore.updateArtifactContent({
              content,
              title: artifact.title,
              type,
              status: 'loaded'
            })
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
