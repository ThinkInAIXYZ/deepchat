<template>
  <div
    class="flex h-full min-h-0 w-full flex-col overflow-hidden"
    data-testid="workspace-preview-pane"
  >
    <div
      v-if="props.previewKind === 'markdown'"
      class="dc-overscroll-contain min-h-0 w-full flex-1 overflow-auto"
      data-testid="workspace-preview-markdown"
    >
      <div class="min-h-full px-4 py-4">
        <MarkdownRenderer
          :content="resolvedContent"
          :final="true"
          :smooth-streaming="false"
          :virtualize-nodes="false"
          :message-id="previewSourceId"
          :thread-id="props.sessionId"
          :link-context="markdownLinkContext"
        />
      </div>
    </div>

    <div
      v-else-if="props.previewKind === 'image'"
      class="dc-overscroll-contain min-h-0 w-full flex-1 overflow-auto bg-muted/20"
      data-testid="workspace-preview-image"
    >
      <div class="flex min-h-full items-center justify-center p-4">
        <img
          v-if="imageSrc"
          :src="imageSrc"
          :alt="resolvedTitle"
          class="max-h-full max-w-full rounded-md object-contain shadow-sm"
        />
      </div>
    </div>

    <div
      v-else-if="documentPreviewUrl"
      class="min-h-0 w-full flex-1 overflow-hidden"
      :data-testid="documentPreviewTestId"
    >
      <iframe
        :src="documentPreviewUrl"
        class="h-full min-h-0 w-full border-0"
        :sandbox="documentPreviewSandbox"
      ></iframe>
    </div>

    <div
      v-else-if="props.previewKind === 'svg' && resolvedBlock"
      class="min-h-0 w-full flex-1 overflow-hidden"
      data-testid="workspace-preview-svg"
    >
      <WorkspaceSvgPreview :block="resolvedBlock" class="h-full min-h-0 w-full" />
    </div>

    <div
      v-else
      class="dc-overscroll-contain min-h-0 w-full flex-1 overflow-auto px-4 py-3"
      data-testid="workspace-preview-raw"
    >
      <pre class="whitespace-pre-wrap break-words text-sm leading-6">{{ resolvedContent }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorkspaceFilePreview } from '@shared/types/workspace'
import type { WorkspacePreviewKind } from '../composables/useWorkspaceViewerModel'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import WorkspaceSvgPreview from './WorkspaceSvgPreview.vue'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

const props = defineProps<{
  sessionId?: string
  previewKind: WorkspacePreviewKind
  filePreview?: WorkspaceFilePreview | null
}>()

const { t } = useI18n()

const fileBlock = computed(() => {
  if (!props.filePreview) {
    return null
  }

  const artifactType =
    props.filePreview.kind === 'markdown'
      ? 'text/markdown'
      : props.filePreview.kind === 'html'
        ? 'text/html'
        : props.filePreview.kind === 'svg'
          ? 'image/svg+xml'
          : props.filePreview.mimeType

  return {
    content: props.filePreview.content,
    artifact: {
      type: artifactType,
      title: props.filePreview.name
    }
  }
})

const resolvedBlock = computed(() => fileBlock.value)
const resolvedContent = computed(() => props.filePreview?.content ?? '')
const previewSourceId = computed(() => props.filePreview?.path)
const markdownLinkContext = computed<MarkdownLinkContext>(() => {
  if (props.filePreview) {
    return {
      source: 'workspace',
      sessionId: props.sessionId,
      sourceFilePath: props.filePreview.path
    }
  }

  return {
    source: 'workspace',
    sessionId: props.sessionId
  }
})
const resolvedTitle = computed(() => props.filePreview?.name ?? t('artifacts.preview'))
const imageSrc = computed(() => props.filePreview?.content || props.filePreview?.thumbnail || '')
const documentPreviewUrl = computed(() => {
  if (!props.filePreview?.previewUrl) {
    return null
  }

  if (!['html', 'pdf', 'svg'].includes(props.previewKind)) {
    return null
  }

  return props.filePreview.previewUrl
})
const documentPreviewSandbox = computed(() => {
  if (props.previewKind === 'html' || props.previewKind === 'svg') {
    return 'allow-scripts allow-same-origin'
  }

  return undefined
})
const documentPreviewTestId = computed(() => `workspace-preview-${props.previewKind}`)
</script>
