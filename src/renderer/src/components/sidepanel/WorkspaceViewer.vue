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
          v-if="shouldShowTabs"
          class="flex items-center rounded-lg bg-muted p-0.5 text-xs text-muted-foreground"
        >
          <button
            class="rounded-md px-2 py-1 transition-colors"
            :class="
              effectiveViewMode === 'preview' ? 'bg-background text-foreground shadow-sm' : ''
            "
            type="button"
            @click="sidepanelStore.setViewMode(props.sessionId, 'preview')"
          >
            {{ t('artifacts.preview') }}
          </button>
          <button
            class="rounded-md px-2 py-1 transition-colors"
            :class="effectiveViewMode === 'code' ? 'bg-background text-foreground shadow-sm' : ''"
            type="button"
            @click="sidepanelStore.setViewMode(props.sessionId, 'code')"
          >
            {{ t('artifacts.code') }}
          </button>
        </div>

        <Button
          v-if="openFilePath"
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
      <div v-if="paneKind === 'empty'" class="flex h-full items-center justify-center px-6">
        <div class="text-center text-sm text-muted-foreground">
          {{ emptyMessage }}
        </div>
      </div>

      <div
        v-else-if="activeSource === 'file' && props.loadingFilePreview"
        class="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
      >
        {{ t('chat.workspace.files.loading') }}
      </div>

      <div
        v-else-if="paneKind === 'git-diff'"
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

      <WorkspaceCodePane v-else-if="paneKind === 'code' && codeSource" :source="codeSource" />

      <WorkspacePreviewPane
        v-else-if="paneKind === 'preview' && previewKind"
        :preview-kind="previewKind"
        :artifact="previewArtifact"
        :file-preview="previewFilePreview"
      />

      <WorkspaceInfoPane
        v-else-if="paneKind === 'info' && props.filePreview"
        :file-preview="props.filePreview"
      />

      <div
        v-else
        class="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
      >
        {{ t('chat.workspace.title') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import type { ArtifactState } from '@/stores/artifact'
import type { WorkspaceFilePreview, WorkspaceGitDiff } from '@shared/presenter'
import { useWorkspaceViewerModel } from './composables/useWorkspaceViewerModel'
import WorkspaceCodePane from './viewer/WorkspaceCodePane.vue'
import WorkspacePreviewPane from './viewer/WorkspacePreviewPane.vue'
import WorkspaceInfoPane from './viewer/WorkspaceInfoPane.vue'

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

const sessionState = computed(() => sidepanelStore.getSessionState(props.sessionId))
const { activeSource, effectiveViewMode, paneKind, previewKind, shouldShowTabs } =
  useWorkspaceViewerModel({
    artifact: computed(() => props.artifact),
    filePreview: computed(() => props.filePreview),
    sessionState
  })

const getPathBasename = (value: string | null | undefined) => {
  if (!value) {
    return ''
  }

  const segments = value.split(/[\\/]+/).filter(Boolean)
  return segments[segments.length - 1] || value
}

const viewerTitle = computed(() => {
  if (activeSource.value === 'artifact') {
    return props.artifact?.title || t('chat.workspace.title')
  }
  if (activeSource.value === 'file') {
    return props.filePreview?.name || getPathBasename(sessionState.value.selectedFilePath)
  }
  if (activeSource.value === 'git-diff') {
    return props.gitDiff?.relativePath || t('chat.workspace.sections.git')
  }
  return t('chat.workspace.title')
})

const viewerSubtitle = computed(() => {
  if (activeSource.value === 'file') {
    return props.filePreview?.relativePath || sessionState.value.selectedFilePath || ''
  }
  if (activeSource.value === 'git-diff') {
    return t('chat.workspace.sections.git')
  }
  return ''
})

const previewArtifact = computed(() => {
  return activeSource.value === 'artifact' ? props.artifact : null
})

const previewFilePreview = computed(() => {
  return activeSource.value === 'file' ? props.filePreview : null
})

const codeSource = computed(() => {
  if (activeSource.value === 'artifact' && props.artifact) {
    return {
      id: props.artifact.id,
      content: props.artifact.content,
      language: props.artifact.language ?? null,
      type: props.artifact.type
    }
  }

  if (activeSource.value !== 'file' || !props.filePreview) {
    return null
  }

  const preview = props.filePreview
  const type =
    preview.kind === 'markdown'
      ? 'text/markdown'
      : preview.kind === 'html'
        ? 'text/html'
        : preview.kind === 'svg'
          ? 'image/svg+xml'
          : preview.mimeType || 'application/vnd.ant.code'

  return {
    id: preview.path,
    content: preview.content,
    language: preview.language ?? null,
    type
  }
})

const openFilePath = computed(() => {
  if (activeSource.value !== 'file') {
    return null
  }

  return props.filePreview?.path ?? sessionState.value.selectedFilePath
})

const emptyMessage = computed(() => {
  if (activeSource.value === 'file' && !props.loadingFilePreview) {
    return t('chat.workspace.files.empty')
  }

  return t('chat.workspace.title')
})

const handleOpenFile = async () => {
  if (!openFilePath.value) {
    return
  }

  await workspacePresenter.openFile(openFilePath.value)
}
</script>
