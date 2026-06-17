<template>
  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
    <div class="flex h-11 shrink-0 items-center justify-between border-b px-3">
      <div class="flex min-w-0 items-center gap-2">
        <Button
          v-if="props.showBackButton"
          variant="ghost"
          size="icon"
          class="h-7 w-7 shrink-0"
          :title="t('common.back')"
          :aria-label="t('common.back')"
          @click="emit('back')"
        >
          <Icon icon="lucide:arrow-left" class="h-4 w-4" />
        </Button>
        <div class="min-w-0">
          <h3 class="truncate text-sm font-medium">{{ viewerTitle }}</h3>
          <p v-if="viewerSubtitle" class="truncate text-xs text-muted-foreground">
            {{ viewerSubtitle }}
          </p>
        </div>
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
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          data-testid="workspace-viewer-fullscreen-toggle"
          :title="fullscreenToggleLabel"
          :aria-label="fullscreenToggleLabel"
          @click="emit('toggle-fullscreen')"
        >
          <Icon
            :icon="props.isFullscreen ? 'lucide:minimize-2' : 'lucide:maximize-2'"
            class="h-4 w-4"
          />
        </Button>

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

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="workspace-viewer-body">
      <div
        v-if="paneKind === 'empty' && !(activeSource === 'file' && props.loadingFilePreview)"
        class="flex h-full items-center justify-center px-6"
      >
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
        class="h-full overflow-auto bg-background py-3 text-xs leading-6"
      >
        <template v-if="props.loadingGitDiff">
          <div class="px-4 text-muted-foreground">{{ t('chat.workspace.files.loading') }}</div>
        </template>
        <template v-else-if="props.gitDiff">
          <section v-if="props.gitDiff.staged" class="mb-4">
            <h4
              class="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ t('chat.workspace.git.staged') }}
            </h4>
            <WorkspaceDiffView :diff="props.gitDiff.staged" />
          </section>
          <section v-if="props.gitDiff.unstaged">
            <h4
              class="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ t('chat.workspace.git.unstaged') }}
            </h4>
            <WorkspaceDiffView :diff="props.gitDiff.unstaged" />
          </section>
          <div
            v-if="!props.gitDiff.staged && !props.gitDiff.unstaged"
            class="px-4 text-muted-foreground"
          >
            {{ t('chat.workspace.git.empty') }}
          </div>
        </template>
        <template v-else>
          <div class="px-4 text-muted-foreground">{{ t('chat.workspace.git.empty') }}</div>
        </template>
      </div>

      <WorkspaceCodePane
        v-else-if="paneKind === 'code' && codeSource"
        class="h-full min-h-0 w-full"
        :source="codeSource"
      />

      <WorkspacePreviewPane
        v-else-if="paneKind === 'preview' && previewKind"
        class="h-full min-h-0 w-full"
        :session-id="props.sessionId"
        :preview-kind="previewKind"
        :artifact="previewArtifact"
        :file-preview="previewFilePreview"
      />

      <WorkspaceInfoPane
        v-else-if="paneKind === 'info' && props.filePreview"
        class="h-full min-h-0 w-full"
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
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { createWorkspaceClient } from '@api/WorkspaceClient'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import type { ArtifactState } from '@/stores/artifact'
import type { WorkspaceFilePreview, WorkspaceGitDiff } from '@shared/presenter'
import { useWorkspaceViewerModel } from './composables/useWorkspaceViewerModel'
import WorkspaceCodePane from './viewer/WorkspaceCodePane.vue'
import WorkspacePreviewPane from './viewer/WorkspacePreviewPane.vue'
import WorkspaceInfoPane from './viewer/WorkspaceInfoPane.vue'
import WorkspaceDiffView from './viewer/WorkspaceDiffView.vue'

const props = defineProps<{
  sessionId: string
  artifact: ArtifactState | null
  filePreview: WorkspaceFilePreview | null
  gitDiff: WorkspaceGitDiff | null
  loadingFilePreview: boolean
  loadingGitDiff: boolean
  isFullscreen?: boolean
  showBackButton?: boolean
}>()

const emit = defineEmits<{
  'toggle-fullscreen': []
  back: []
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const workspaceClient = createWorkspaceClient()

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

const fullscreenToggleLabel = computed(() => {
  return props.isFullscreen ? t('common.restore') : t('common.maximize')
})

const handleOpenFile = async () => {
  if (!openFilePath.value) {
    return
  }

  await workspaceClient.openFile(openFilePath.value)
}
</script>
