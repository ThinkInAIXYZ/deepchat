<template>
  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
    <div class="flex h-11 shrink-0 items-center justify-between border-b px-3">
      <div class="flex min-w-0 items-center gap-2">
        <DcButton
          v-if="props.showBackButton"
          variant="ghost"
          size="icon"
          class="h-7 w-7 shrink-0"
          :tooltip="t('common.back')"
          :aria-label="t('common.back')"
          @click="emit('back')"
        >
          <Icon icon="lucide:arrow-left" class="h-4 w-4" />
        </DcButton>
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

        <DcButton
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          data-testid="workspace-viewer-fullscreen-toggle"
          :tooltip="fullscreenToggleLabel"
          :aria-label="fullscreenToggleLabel"
          @click="emit('toggle-fullscreen')"
        >
          <Icon
            :icon="props.isFullscreen ? 'lucide:minimize-2' : 'lucide:maximize-2'"
            class="h-4 w-4"
          />
        </DcButton>

        <div v-if="openFilePath" class="flex items-center">
          <DcButton
            variant="outline"
            size="icon"
            class="h-7 w-7 rounded-r-none border-r-0"
            :tooltip="preferredAppLabel"
            @click="handleOpenFile"
          >
            <img
              v-if="preferredApp?.iconDataUrl"
              :src="preferredApp.iconDataUrl"
              alt=""
              class="h-4 w-4"
            />
            <Icon v-else icon="lucide:external-link" class="h-4 w-4" />
          </DcButton>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <DcButton
                variant="outline"
                size="icon"
                class="h-7 w-6 rounded-l-none"
                :tooltip="t('chat.workspace.files.contextMenu.openWith')"
              >
                <Icon icon="lucide:chevron-down" class="h-3.5 w-3.5" />
              </DcButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" class="min-w-52">
              <DropdownMenuItem
                v-for="openApp in editorApps"
                :key="openApp.id"
                @select="handleOpenWithApp(openApp)"
              >
                <img v-if="openApp.iconDataUrl" :src="openApp.iconDataUrl" alt="" class="h-4 w-4" />
                <Icon v-else icon="lucide:app-window" class="h-4 w-4" />
                {{ openAppLabel(openApp) }}
              </DropdownMenuItem>

              <DropdownMenuSeparator v-if="editorApps.length > 0 && terminalApps.length > 0" />

              <DropdownMenuItem
                v-for="openApp in terminalApps"
                :key="openApp.id"
                @select="handleOpenWithApp(openApp)"
              >
                <img v-if="openApp.iconDataUrl" :src="openApp.iconDataUrl" alt="" class="h-4 w-4" />
                <Icon v-else icon="lucide:app-window" class="h-4 w-4" />
                {{ openAppLabel(openApp) }}
              </DropdownMenuItem>

              <DropdownMenuSeparator v-if="openApps.length > 0" />

              <DropdownMenuItem @select="handleRevealInFolder">
                <Icon icon="lucide:folder-open-dot" class="h-4 w-4" />
                {{ t('chat.workspace.files.contextMenu.revealInFolder') }}
              </DropdownMenuItem>
              <DropdownMenuItem @select="handleOpenWithSystemDefault">
                <Icon icon="lucide:external-link" class="h-4 w-4" />
                {{ t('chat.workspace.files.contextMenu.openWithSystemDefault') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
        class="dc-overscroll-contain h-full overflow-auto bg-background py-3 text-xs leading-6"
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
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { createWorkspaceClient } from '@api/WorkspaceClient'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import type { ArtifactState } from '@/stores/artifact'
import type {
  WorkspaceFileOpenApp,
  WorkspaceFilePreview,
  WorkspaceGitDiff
} from '@shared/types/workspace'
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

const PREFERRED_OPEN_APP_STORAGE_KEY = 'workspace.openWith.preferredAppId'
/** Sentinel for "use the system default handler"; no registry id can collide. */
const SYSTEM_DEFAULT_APP_ID = '#system-default'

const openApps = ref<WorkspaceFileOpenApp[]>([])
const preferredAppId = ref<string | null>(
  globalThis.localStorage?.getItem(PREFERRED_OPEN_APP_STORAGE_KEY) ?? null
)

const rememberPreferredApp = (appId: string) => {
  preferredAppId.value = appId
  globalThis.localStorage?.setItem(PREFERRED_OPEN_APP_STORAGE_KEY, appId)
}

const editorApps = computed(() => openApps.value.filter((item) => item.kind === 'editor'))
const terminalApps = computed(() => openApps.value.filter((item) => item.kind === 'terminal'))

/**
 * App used by the primary button: only ever the app the user last picked. Nothing
 * is auto-picked, so the button keeps opening the system default handler until the
 * user chooses otherwise from the dropdown.
 */
const preferredApp = computed(
  () => openApps.value.find((item) => item.id === preferredAppId.value) ?? null
)

/** Terminals open the containing directory, so they get their own label. */
const openAppLabel = (openApp: WorkspaceFileOpenApp) =>
  openApp.kind === 'terminal'
    ? t('chat.workspace.files.contextMenu.openInTerminalApp', { app: openApp.name })
    : t('chat.workspace.files.contextMenu.openInApp', { app: openApp.name })

const preferredAppLabel = computed(() =>
  preferredApp.value
    ? openAppLabel(preferredApp.value)
    : t('chat.workspace.files.contextMenu.openFile')
)

watch(
  openFilePath,
  async (filePath) => {
    openApps.value = []
    if (!filePath) {
      return
    }

    try {
      const apps = await workspaceClient.listFileOpenApps(filePath)
      if (openFilePath.value === filePath) {
        openApps.value = apps
      }
    } catch (error) {
      // An empty list just hides the picker entries; the primary button and
      // "system default" still work, so this needs no user-facing error.
      console.warn('[WorkspaceViewer] Failed to list open-with applications:', error)
    }
  },
  { immediate: true }
)

/**
 * Run a workspace client action against the file currently in the viewer, and
 * tell the user when it fails instead of failing silently.
 */
const runOnOpenFile = async (action: (filePath: string) => Promise<unknown>) => {
  if (!openFilePath.value) {
    return
  }

  try {
    await action(openFilePath.value)
  } catch (error) {
    console.warn('[WorkspaceViewer] Failed to open file:', error)
    notifyRenderer({
      kind: 'error',
      code: 'chat.workspace.openFileFailed',
      title: t('common.error.operationFailed'),
      description: t('chat.workspace.files.contextMenu.openFailed')
    })
  }
}

const handleRevealInFolder = () => runOnOpenFile(workspaceClient.revealFileInFolder)

const handleOpenWithSystemDefault = () => {
  rememberPreferredApp(SYSTEM_DEFAULT_APP_ID)
  return runOnOpenFile(workspaceClient.openFile)
}

const handleOpenFile = () =>
  runOnOpenFile((filePath) =>
    preferredApp.value
      ? workspaceClient.openFileWithApp(filePath, preferredApp.value.id)
      : workspaceClient.openFile(filePath)
  )

const handleOpenWithApp = (openApp: WorkspaceFileOpenApp) => {
  rememberPreferredApp(openApp.id)
  return runOnOpenFile((filePath) => workspaceClient.openFileWithApp(filePath, openApp.id))
}
</script>
