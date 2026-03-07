<template>
  <div class="flex h-full min-w-0 flex-1 flex-col bg-background">
    <div class="flex h-11 items-center justify-between border-b px-3">
      <div class="min-w-0">
        <h3 class="truncate text-sm font-medium">{{ viewerTitle }}</h3>
        <p v-if="viewerSubtitle" class="truncate text-xs text-muted-foreground">
          {{ viewerSubtitle }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <div
          v-if="canToggleViewMode"
          class="flex items-center rounded-lg bg-muted p-0.5 text-xs text-muted-foreground"
        >
          <button
            class="rounded-md px-2 py-1 transition-colors"
            :class="viewMode === 'preview' ? 'bg-background text-foreground shadow-sm' : ''"
            type="button"
            @click="sidepanelStore.setViewMode(props.sessionId, 'preview')"
          >
            {{ t('artifacts.preview') }}
          </button>
          <button
            class="rounded-md px-2 py-1 transition-colors"
            :class="viewMode === 'code' ? 'bg-background text-foreground shadow-sm' : ''"
            type="button"
            @click="sidepanelStore.setViewMode(props.sessionId, 'code')"
          >
            {{ t('artifacts.code') }}
          </button>
        </div>

        <Button
          v-if="props.filePreview"
          variant="outline"
          size="sm"
          class="h-7 text-xs"
          @click="handleOpenFile"
        >
          {{ t('chat.workspace.files.contextMenu.openFile') }}
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <div
        v-if="isEmpty"
        class="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
      >
        {{ t('chat.workspace.title') }}
      </div>

      <div
        v-else-if="activeSource === 'git-diff'"
        class="h-full overflow-auto bg-background px-4 py-3 font-mono text-xs leading-6"
      >
        <template v-if="props.loadingGitDiff">
          <div class="text-muted-foreground">{{ t('chat.workspace.files.loading') }}</div>
        </template>
        <template v-else-if="props.gitDiff">
          <section v-if="props.gitDiff.staged" class="mb-4">
            <h4
              class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ t('chat.workspace.git.staged') }}
            </h4>
            <pre class="whitespace-pre-wrap break-words">{{ props.gitDiff.staged }}</pre>
          </section>
          <section v-if="props.gitDiff.unstaged">
            <h4
              class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ t('chat.workspace.git.unstaged') }}
            </h4>
            <pre class="whitespace-pre-wrap break-words">{{ props.gitDiff.unstaged }}</pre>
          </section>
          <div
            v-if="!props.gitDiff.staged && !props.gitDiff.unstaged"
            class="text-muted-foreground"
          >
            {{ t('chat.workspace.git.empty') }}
          </div>
        </template>
        <template v-else>
          <div class="text-muted-foreground">{{ t('chat.workspace.git.empty') }}</div>
        </template>
      </div>

      <div
        v-else-if="showCodeView"
        ref="codeEditorRef"
        class="h-full min-h-[30px] overflow-auto bg-background text-xs"
      ></div>

      <div v-else-if="activeSource === 'file' && props.filePreview" class="h-full overflow-auto">
        <template v-if="props.loadingFilePreview">
          <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
            {{ t('chat.workspace.files.loading') }}
          </div>
        </template>
        <template v-else-if="props.filePreview.kind === 'image'">
          <div class="flex h-full items-center justify-center bg-muted/20 p-4">
            <img
              :src="props.filePreview.content || props.filePreview.thumbnail"
              :alt="props.filePreview.name"
              class="max-h-full max-w-full rounded-md object-contain shadow-sm"
            />
          </div>
        </template>
        <template v-else-if="props.filePreview.kind === 'binary'">
          <div class="space-y-2 p-4 text-sm">
            <div class="text-muted-foreground">{{ props.filePreview.mimeType }}</div>
            <div class="text-muted-foreground">
              {{ Math.max(0, Number(props.filePreview.metadata.fileSize) || 0) }} bytes
            </div>
          </div>
        </template>
        <template v-else-if="previewBlock && previewComponent">
          <component
            :is="previewComponent"
            :block="previewBlock"
            :is-preview="true"
            viewport-size="desktop"
            class="h-full"
          />
        </template>
        <template v-else>
          <pre class="whitespace-pre-wrap break-words p-4 text-sm leading-6">{{
            props.filePreview.content
          }}</pre>
        </template>
      </div>

      <div v-else-if="activeSource === 'artifact' && previewBlock" class="h-full overflow-auto">
        <component
          v-if="previewComponent"
          :is="previewComponent"
          :block="previewBlock"
          :is-preview="true"
          viewport-size="desktop"
          class="h-full"
        />
        <pre v-else class="whitespace-pre-wrap break-words p-4 text-sm leading-6">{{
          previewBlock.content
        }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { useArtifactCodeEditor } from '@/composables/useArtifactCodeEditor'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import type { ArtifactState } from '@/stores/artifact'
import type { WorkspaceFilePreview, WorkspaceGitDiff } from '@shared/presenter'
import CodeArtifact from '@/components/artifacts/CodeArtifact.vue'
import MarkdownArtifact from '@/components/artifacts/MarkdownArtifact.vue'
import HTMLArtifact from '@/components/artifacts/HTMLArtifact.vue'
import SvgArtifact from '@/components/artifacts/SvgArtifact.vue'
import MermaidArtifact from '@/components/artifacts/MermaidArtifact.vue'
import ReactArtifact from '@/components/artifacts/ReactArtifact.vue'

const props = defineProps<{
  sessionId: string
  artifact: ArtifactState | null
  filePreview: WorkspaceFilePreview | null
  gitDiff: WorkspaceGitDiff | null
  loadingFilePreview: boolean
  loadingGitDiff: boolean
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const workspacePresenter = usePresenter('workspacePresenter')
const codeEditorRef = ref<HTMLElement | null>(null)

const sessionState = computed(() => sidepanelStore.getSessionState(props.sessionId))
const viewMode = computed(() => sessionState.value.viewMode)

const activeSource = computed<'artifact' | 'file' | 'git-diff' | null>(() => {
  if (sessionState.value.selectedDiffPath) {
    return 'git-diff'
  }
  if (sessionState.value.selectedFilePath) {
    return props.filePreview ? 'file' : null
  }
  if (sessionState.value.selectedArtifactContext && props.artifact) {
    return 'artifact'
  }
  return null
})

const codeArtifact = computed<ArtifactState | null>(() => {
  if (activeSource.value === 'artifact') {
    return props.artifact
  }

  if (activeSource.value !== 'file' || !props.filePreview) {
    return null
  }

  const preview = props.filePreview
  const artifactType =
    preview.kind === 'markdown'
      ? 'text/markdown'
      : preview.kind === 'html'
        ? 'text/html'
        : preview.kind === 'svg'
          ? 'image/svg+xml'
          : 'application/vnd.ant.code'

  return {
    id: preview.path,
    type: artifactType,
    title: preview.name,
    language: preview.language ?? undefined,
    content: preview.content,
    status: 'loaded'
  }
})

useArtifactCodeEditor(
  codeArtifact as never,
  codeEditorRef,
  computed(() => viewMode.value === 'preview') as never,
  computed(() => true) as never
)

const previewComponent = computed(() => {
  const target = codeArtifact.value
  if (!target) return null

  switch (target.type) {
    case 'application/vnd.ant.code':
      return CodeArtifact
    case 'text/markdown':
      return MarkdownArtifact
    case 'text/html':
      return HTMLArtifact
    case 'image/svg+xml':
      return SvgArtifact
    case 'application/vnd.ant.mermaid':
      return MermaidArtifact
    case 'application/vnd.ant.react':
      return ReactArtifact
    default:
      return null
  }
})

const previewBlock = computed(() => {
  const target = codeArtifact.value
  if (!target) {
    return null
  }

  return {
    content: target.content,
    artifact: {
      type: target.type,
      title: target.title
    }
  }
})

const viewerTitle = computed(() => {
  if (activeSource.value === 'artifact') {
    return props.artifact?.title || t('chat.workspace.title')
  }
  if (activeSource.value === 'file') {
    return props.filePreview?.name || t('chat.workspace.title')
  }
  if (activeSource.value === 'git-diff') {
    return props.gitDiff?.relativePath || t('chat.workspace.sections.git')
  }
  return t('chat.workspace.title')
})

const viewerSubtitle = computed(() => {
  if (activeSource.value === 'file') {
    return props.filePreview?.relativePath || ''
  }
  if (activeSource.value === 'git-diff') {
    return t('chat.workspace.sections.git')
  }
  return ''
})

const canToggleViewMode = computed(() => {
  if (activeSource.value === 'artifact') {
    return true
  }

  if (activeSource.value !== 'file' || !props.filePreview) {
    return false
  }

  return props.filePreview.kind !== 'binary' && props.filePreview.kind !== 'image'
})

const showCodeView = computed(() => canToggleViewMode.value && viewMode.value === 'code')
const isEmpty = computed(() => activeSource.value == null)

const handleOpenFile = async () => {
  if (!props.filePreview) {
    return
  }

  await workspacePresenter.openFile(props.filePreview.path)
}
</script>
