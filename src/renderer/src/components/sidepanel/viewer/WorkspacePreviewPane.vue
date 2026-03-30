<template>
  <div
    v-if="props.previewKind === 'markdown'"
    class="h-full min-h-0 overflow-auto"
    data-testid="workspace-preview-markdown"
  >
    <div class="min-h-full px-4 py-4">
      <MarkdownRenderer
        :content="resolvedContent"
        :message-id="previewSourceId"
        :thread-id="props.sessionId"
      />
    </div>
  </div>

  <div
    v-else-if="props.previewKind === 'image'"
    class="h-full min-h-0 overflow-auto bg-muted/20"
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
    class="h-full min-h-0 overflow-hidden"
    :data-testid="documentPreviewTestId"
  >
    <iframe
      :src="documentPreviewUrl"
      class="h-full w-full border-0"
      :sandbox="documentPreviewSandbox"
    ></iframe>
  </div>

  <div
    v-else-if="props.previewKind === 'html' && artifactBlock"
    class="h-full min-h-0 overflow-hidden"
    data-testid="workspace-preview-html-artifact"
  >
    <HTMLArtifact
      :block="artifactBlock"
      :is-preview="true"
      viewport-size="desktop"
      class="h-full"
    />
  </div>

  <div
    v-else-if="props.previewKind === 'svg' && resolvedBlock"
    class="h-full min-h-0 overflow-hidden"
    data-testid="workspace-preview-svg"
  >
    <SvgArtifact :block="resolvedBlock" class="h-full" />
  </div>

  <div
    v-else-if="props.previewKind === 'mermaid' && artifactBlock"
    class="h-full min-h-0 overflow-hidden"
    data-testid="workspace-preview-mermaid"
  >
    <MermaidArtifact :block="artifactBlock" :is-preview="true" class="h-full" />
  </div>

  <div
    v-else-if="props.previewKind === 'react' && artifactBlock"
    class="h-full min-h-0 overflow-hidden"
    data-testid="workspace-preview-react"
  >
    <ReactArtifact :block="artifactBlock" :is-preview="true" class="h-full" />
  </div>

  <div v-else class="h-full min-h-0 overflow-auto px-4 py-3" data-testid="workspace-preview-raw">
    <pre class="whitespace-pre-wrap break-words text-sm leading-6">{{ resolvedContent }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ArtifactState } from '@/stores/artifact'
import type { WorkspaceFilePreview } from '@shared/presenter'
import type { WorkspacePreviewKind } from '../composables/useWorkspaceViewerModel'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import HTMLArtifact from '@/components/artifacts/HTMLArtifact.vue'
import SvgArtifact from '@/components/artifacts/SvgArtifact.vue'
import MermaidArtifact from '@/components/artifacts/MermaidArtifact.vue'
import ReactArtifact from '@/components/artifacts/ReactArtifact.vue'

const props = defineProps<{
  sessionId?: string
  previewKind: WorkspacePreviewKind
  artifact?: ArtifactState | null
  filePreview?: WorkspaceFilePreview | null
}>()

const { t } = useI18n()

const artifactBlock = computed(() => {
  if (!props.artifact) {
    return null
  }

  return {
    content: props.artifact.content,
    artifact: {
      type: props.artifact.type,
      title: props.artifact.title
    }
  }
})

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

const resolvedBlock = computed(() => artifactBlock.value ?? fileBlock.value)
const resolvedContent = computed(() => props.artifact?.content ?? props.filePreview?.content ?? '')
const previewSourceId = computed(() => props.artifact?.id ?? props.filePreview?.path)
const resolvedTitle = computed(
  () => props.artifact?.title ?? props.filePreview?.name ?? t('artifacts.preview')
)
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
