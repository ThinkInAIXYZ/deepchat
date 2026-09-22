<!-- eslint-disable @typescript-eslint/no-explicit-any -->
<template>
  <template v-for="(part, index) in processedContent" :key="index">
    <!-- 使用结构化渲染器替代 v-html -->
    <MarkdownRenderer
      v-if="part.type === 'text'"
      :content="part.content"
      :loading="part.loading"
      mode="chat"
      :smooth-streaming="shouldSmoothStream"
      :streaming="isStreamingPart(part)"
      :final="!isStreamingPart(part)"
      :virtualize-nodes="shouldVirtualizeNodes"
      :message-id="messageId"
      :thread-id="threadId"
      :link-context="{
        source: 'chat',
        sessionId: threadId
      }"
      :hidden-image-sources="hiddenMarkdownImageSources"
    />

    <div v-else-if="part.type === 'artifact' && part.artifact" class="my-1">
      <LegacyArtifactSource
        :block="{
          content: part.content,
          artifact: part.artifact
        }"
      />
    </div>
    <div v-else-if="part.type === 'tool_call' && part.tool_call" class="my-1">
      <ToolCallPreview :block="part" :block-status="props.block.status" />
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import LegacyArtifactSource from './LegacyArtifactSource.vue'
import ToolCallPreview from './ToolCallPreview.vue'
import { useBlockContent, type ProcessedPart } from '@/composables/useArtifacts'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

const props = defineProps<{
  block: DisplayAssistantMessageBlock
  messageId: string
  threadId: string
  isSearchResult?: boolean
  disableMarkdownVirtualization?: boolean
  hiddenMarkdownImageSources?: readonly string[]
}>()

const { processedContent } = useBlockContent(props)
const shouldSmoothStream = computed(
  () => props.block.status === 'pending' || props.block.status === 'loading'
)
const isStreamingPart = (part: ProcessedPart) => shouldSmoothStream.value || Boolean(part.loading)
const shouldVirtualizeNodes = computed(
  () => !props.disableMarkdownVirtualization && !props.isSearchResult
)
</script>
