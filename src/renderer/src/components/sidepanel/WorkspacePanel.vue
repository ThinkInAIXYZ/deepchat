<template>
  <div class="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
    <aside
      class="workspace-nav relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r bg-muted/20"
      :class="{ 'workspace-nav--resizing': isNavResizing }"
      :style="navStyle"
    >
      <div class="flex h-full min-h-0 shrink-0 flex-col" :style="{ width: expandedNavWidth }">
        <button
          class="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
          type="button"
          :title="navCollapsed ? t('chat.workspace.expand') : t('chat.workspace.collapse')"
          @click="sidepanelStore.toggleNavCollapsed()"
        >
          <Icon
            :icon="navCollapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'"
            class="h-3.5 w-3.5 shrink-0"
          />
        </button>
        <div class="min-h-0 flex-1 overflow-auto pb-2">
          <section>
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
              type="button"
              @click="handleSectionClick('files')"
            >
              <Icon icon="lucide:folder-tree" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span v-show="!navCollapsed" class="flex-1 truncate">{{
                t('chat.workspace.sections.files')
              }}</span>
              <Icon
                v-show="!navCollapsed"
                :icon="sessionState.sections.files ? 'lucide:chevron-down' : 'lucide:chevron-right'"
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </button>
            <div v-if="!navCollapsed && sessionState.sections.files" class="pb-2">
              <div
                v-if="!props.workspacePath"
                class="mx-2 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-4 text-center"
                :class="{ 'border-primary bg-primary/5': isDragging }"
                @dragenter.prevent="isDragging = true"
                @dragover.prevent="handleDragOver"
                @dragleave="handleDragLeave"
                @drop.prevent="handleDrop"
              >
                <Icon
                  icon="lucide:folder-plus"
                  class="mx-auto mb-2 h-6 w-6 text-muted-foreground"
                />
                <p class="mb-2 text-xs font-medium text-foreground">
                  {{ t('chat.workspace.files.noWorkspace.title') }}
                </p>
                <p class="mb-3 text-[11px] text-muted-foreground">
                  {{ t('chat.workspace.files.noWorkspace.description') }}
                </p>
                <Button variant="outline" size="sm" class="h-7 text-xs" @click="selectFolder">
                  <Icon icon="lucide:folder-open" class="mr-1.5 h-3.5 w-3.5" />
                  {{ t('chat.workspace.files.noWorkspace.button') }}
                </Button>
              </div>
              <div v-else-if="loadingFiles" class="px-3 py-2 text-[11px] text-muted-foreground/70">
                {{ t('chat.workspace.files.loading') }}
              </div>
              <WorkspaceFileNode
                v-for="node in fileTree"
                :key="node.path"
                :node="node"
                :depth="0"
                @toggle="toggleNode"
                @append-path="handleFileSelect"
                @insert-path="handleInsertFileReference"
              />
            </div>
          </section>

          <section v-if="gitState">
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
              type="button"
              @click="handleSectionClick('git')"
            >
              <Icon icon="lucide:git-branch" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span v-show="!navCollapsed" class="flex-1 truncate">{{
                t('chat.workspace.sections.git')
              }}</span>
              <span v-show="!navCollapsed" class="text-[11px] text-muted-foreground">{{
                gitState.changes.length
              }}</span>
              <Icon
                v-show="!navCollapsed"
                :icon="sessionState.sections.git ? 'lucide:chevron-down' : 'lucide:chevron-right'"
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </button>
            <div v-if="!navCollapsed && sessionState.sections.git" class="pb-2">
              <button
                v-for="change in gitState.changes"
                :key="change.path"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                :class="
                  sessionState.selectedDiffPath === change.path
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                "
                type="button"
                @click="handleDiffSelect(change.path)"
              >
                <span class="w-4 shrink-0 text-center font-mono text-[11px]">
                  {{ formatGitFlag(change) }}
                </span>
                <span class="min-w-0 flex-1 truncate">{{ change.relativePath }}</span>
              </button>
              <div
                v-if="gitState.changes.length === 0"
                class="px-3 py-2 text-[11px] text-muted-foreground/70"
              >
                {{ t('chat.workspace.git.clean') }}
              </div>
            </div>
          </section>

          <section v-if="artifactItems.length > 0">
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
              type="button"
              @click="handleSectionClick('artifacts')"
            >
              <Icon icon="lucide:box" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span v-show="!navCollapsed" class="flex-1 truncate">{{
                t('chat.workspace.sections.artifacts')
              }}</span>
              <span v-show="!navCollapsed" class="text-[11px] text-muted-foreground">{{
                artifactItems.length
              }}</span>
              <Icon
                v-show="!navCollapsed"
                :icon="
                  sessionState.sections.artifacts ? 'lucide:chevron-down' : 'lucide:chevron-right'
                "
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </button>
            <div v-if="!navCollapsed && sessionState.sections.artifacts" class="pb-2">
              <button
                v-for="item in artifactItems"
                :key="item.key"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                :class="
                  isArtifactSelected(item)
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                "
                type="button"
                @click="handleArtifactSelect(item)"
              >
                <Icon :icon="getArtifactIcon(item.type)" class="h-3.5 w-3.5 shrink-0" />
                <span class="min-w-0 flex-1 truncate">{{ item.title || item.identifier }}</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      <button
        v-if="!navCollapsed"
        data-testid="workspace-nav-resize-handle"
        class="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize"
        type="button"
        @mousedown="startNavResize"
      ></button>
    </aside>

    <WorkspaceViewer
      :session-id="props.sessionId"
      :artifact="selectedArtifact"
      :file-preview="selectedFilePreview"
      :git-diff="selectedGitDiff"
      :loading-file-preview="loadingFilePreview"
      :loading-git-diff="loadingGitDiff"
      :is-fullscreen="props.isFullscreen"
      @toggle-fullscreen="emit('toggle-fullscreen')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useI18n } from 'vue-i18n'
import { createFileClient } from '@api/FileClient'
import { createProjectClient } from '@api/ProjectClient'
import { createWorkspaceClient } from '@api/WorkspaceClient'
import { extractArtifactsFromContent } from '@/composables/useArtifacts'
import WorkspaceFileNode from '@/components/workspace/WorkspaceFileNode.vue'
import WorkspaceViewer from './WorkspaceViewer.vue'
import { useWorkspaceSync } from './composables/useWorkspaceSync'
import { useArtifactStore } from '@/stores/artifact'
import { useMessageStore } from '@/stores/ui/message'
import { useSidepanelStore, type WorkspaceArtifactContext } from '@/stores/ui/sidepanel'
import { useSessionStore } from '@/stores/ui/session'
import type { WorkspaceGitFileChange, WorkspaceNavSection } from '@shared/presenter'

const props = defineProps<{
  sessionId: string
  workspacePath: string | null
  isFullscreen?: boolean
}>()

const emit = defineEmits<{
  'update:workspacePath': [path: string | null]
  'toggle-fullscreen': []
  'insert-file-reference': [filePath: string]
}>()

type ArtifactItem = WorkspaceArtifactContext & {
  key: string
  identifier: string
  title: string
  type: string
  language?: string
  content: string
  status: 'loading' | 'loaded'
  createdAt: number
}

const { t } = useI18n()
const artifactStore = useArtifactStore()
const messageStore = useMessageStore()
const sidepanelStore = useSidepanelStore()
const sessionStore = useSessionStore()
const workspaceClient = createWorkspaceClient()
const projectClient = createProjectClient()
const fileClient = createFileClient()

const sessionState = computed(() => sidepanelStore.getSessionState(props.sessionId))
const {
  fileTree,
  selectedFilePreview,
  selectedGitDiff,
  gitState,
  loadingFiles,
  loadingFilePreview,
  loadingGitDiff,
  toggleNode
} = useWorkspaceSync({
  sessionId: toRef(props, 'sessionId'),
  workspacePath: toRef(props, 'workspacePath'),
  active: computed(() => sidepanelStore.open),
  sessionState,
  workspaceClient,
  sidepanelStore
})

const artifactItems = computed<ArtifactItem[]>(() => {
  const items: ArtifactItem[] = []

  for (const message of messageStore.messages) {
    if (message.sessionId !== props.sessionId || message.role !== 'assistant') {
      continue
    }

    for (const block of messageStore.getAssistantMessageBlocks(message)) {
      for (const artifact of extractArtifactsFromContent(block.content ?? '', block.status)) {
        items.push({
          key: `${message.id}:${artifact.identifier}`,
          threadId: props.sessionId,
          messageId: message.id,
          artifactId: artifact.identifier,
          identifier: artifact.identifier,
          title: artifact.title,
          type: artifact.type,
          language: artifact.language,
          content: artifact.content,
          status: artifact.loading ? 'loading' : 'loaded',
          createdAt: message.createdAt
        })
      }
    }
  }

  return items.sort((left, right) => right.createdAt - left.createdAt)
})

const selectedArtifact = computed(() => {
  const context = sessionState.value.selectedArtifactContext
  if (!context) {
    return null
  }

  if (
    artifactStore.currentArtifact &&
    artifactStore.currentArtifact.id === context.artifactId &&
    artifactStore.currentMessageId === context.messageId &&
    artifactStore.currentThreadId === context.threadId
  ) {
    return artifactStore.currentArtifact
  }

  const matched = artifactItems.value.find(
    (item) =>
      item.threadId === context.threadId &&
      item.messageId === context.messageId &&
      item.artifactId === context.artifactId
  )

  if (!matched) {
    return null
  }

  return {
    id: matched.artifactId,
    type: matched.type,
    title: matched.title,
    language: matched.language,
    content: matched.content,
    status: matched.status
  }
})

watch(
  [artifactItems, () => sessionState.value.selectedArtifactContext] as const,
  ([items, context]) => {
    if (!context) {
      return
    }

    const existsInArtifactItems = items.some(
      (item) =>
        item.threadId === context.threadId &&
        item.messageId === context.messageId &&
        item.artifactId === context.artifactId
    )

    const matchesCurrentArtifact =
      artifactStore.currentArtifact?.id === context.artifactId &&
      artifactStore.currentMessageId === context.messageId &&
      artifactStore.currentThreadId === context.threadId

    if (!existsInArtifactItems && !matchesCurrentArtifact) {
      sidepanelStore.clearArtifact(props.sessionId)
    }
  },
  { immediate: true }
)

// px-3 (12) + icon (14) + px-3 (12) so the leading icons sit centered in the collapsed rail
const NAV_COLLAPSED_WIDTH = 38

const navCollapsed = computed(() => sidepanelStore.navCollapsed)
const isNavResizing = ref(false)

const expandedNavWidth = computed(() => `${sidepanelStore.navWidth}px`)

const navStyle = computed(() => ({
  width: navCollapsed.value ? `${NAV_COLLAPSED_WIDTH}px` : expandedNavWidth.value
}))

const expandNavToSection = (section: WorkspaceNavSection) => {
  sidepanelStore.setNavCollapsed(false)
  const state = sidepanelStore.ensureSessionState(props.sessionId)
  state.sections[section] = true
}

const handleSectionClick = (section: WorkspaceNavSection) => {
  if (navCollapsed.value) {
    expandNavToSection(section)
    return
  }
  sidepanelStore.toggleSection(props.sessionId, section)
}

let navResizeCleanup: (() => void) | null = null
let pendingNavWidth: number | null = null
let navResizeFrame: number | null = null

const applyPendingNavResize = () => {
  navResizeFrame = null
  if (pendingNavWidth === null) {
    return
  }
  sidepanelStore.setNavWidth(pendingNavWidth)
  pendingNavWidth = null
}

const stopNavResize = () => {
  navResizeCleanup?.()
  navResizeCleanup = null
  if (navResizeFrame !== null) {
    window.cancelAnimationFrame(navResizeFrame)
    navResizeFrame = null
  }
  if (pendingNavWidth !== null) {
    sidepanelStore.setNavWidth(pendingNavWidth)
    pendingNavWidth = null
  }
}

const startNavResize = (event: MouseEvent) => {
  event.preventDefault()
  stopNavResize()
  isNavResizing.value = true

  const startX = event.clientX
  const startWidth = sidepanelStore.navWidth

  const onMouseMove = (moveEvent: MouseEvent) => {
    pendingNavWidth = startWidth + (moveEvent.clientX - startX)
    if (navResizeFrame === null) {
      navResizeFrame = window.requestAnimationFrame(applyPendingNavResize)
    }
  }

  const onMouseUp = () => {
    isNavResizing.value = false
    stopNavResize()
  }

  window.addEventListener('mousemove', onMouseMove, { passive: true })
  window.addEventListener('mouseup', onMouseUp, { once: true })
  navResizeCleanup = () => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    isNavResizing.value = false
  }
}

onBeforeUnmount(() => {
  stopNavResize()
})

const handleFileSelect = (filePath: string) => {
  sidepanelStore.selectFile(props.sessionId, filePath, {
    open: false,
    viewMode: 'preview'
  })
}

const handleInsertFileReference = (filePath: string) => {
  emit('insert-file-reference', filePath)
}

const handleDiffSelect = (filePath: string) => {
  sidepanelStore.selectDiff(props.sessionId, filePath, { open: false })
}

const handleArtifactSelect = (item: ArtifactItem) => {
  artifactStore.showArtifact(
    {
      id: item.artifactId,
      type: item.type,
      title: item.title,
      language: item.language,
      content: item.content,
      status: item.status
    },
    item.messageId,
    item.threadId,
    {
      force: true,
      open: false,
      viewMode: 'preview'
    }
  )
}

const isArtifactSelected = (item: ArtifactItem) => {
  const context = sessionState.value.selectedArtifactContext
  return (
    context?.threadId === item.threadId &&
    context?.messageId === item.messageId &&
    context?.artifactId === item.artifactId
  )
}

const formatGitFlag = (change: WorkspaceGitFileChange) => {
  return change.stagedStatus || change.unstagedStatus || 'M'
}

const getArtifactIcon = (type: string) => {
  switch (type) {
    case 'application/vnd.ant.code':
      return 'lucide:square-code'
    case 'text/markdown':
      return 'vscode-icons:file-type-markdown'
    case 'text/html':
      return 'vscode-icons:file-type-html'
    case 'image/svg+xml':
      return 'vscode-icons:file-type-svg'
    case 'application/vnd.ant.mermaid':
      return 'vscode-icons:file-type-mermaid'
    case 'application/vnd.ant.react':
      return 'vscode-icons:file-type-reactts'
    default:
      return 'lucide:file'
  }
}

const isDragging = ref(false)

async function selectFolder() {
  try {
    const selectedPath = await projectClient.selectDirectory()
    if (selectedPath) {
      await sessionStore.setSessionProjectDir(props.sessionId, selectedPath)
      emit('update:workspacePath', selectedPath)
    }
  } catch (e) {
    console.error('Failed to select folder:', e)
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  if (hasDroppedFiles(event)) {
    isDragging.value = true
  }
}

function handleDragLeave(event: DragEvent) {
  // Only reset dragging if we're leaving the drop zone entirely, not entering a child element
  const relatedTarget = event.relatedTarget as EventTarget | null
  if (
    !relatedTarget ||
    !(event.currentTarget instanceof Node) ||
    !event.currentTarget.contains(relatedTarget as Node)
  ) {
    isDragging.value = false
  }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false

  const file = getDroppedFile(event)
  if (!file) {
    console.log('[WorkspacePanel] No files in drop event')
    return
  }

  const filePath = getDroppedFilePath(file)

  console.log('[WorkspacePanel] Dropped file:', filePath, file.name)

  if (!filePath) {
    console.log('[WorkspacePanel] No file path available - drag from browser')
    return
  }

  try {
    const isDirectory = await fileClient.isDirectory(filePath)
    if (!isDirectory) {
      console.warn('[WorkspacePanel] Dropped path is not a directory:', filePath)
      return
    }

    console.log('[WorkspacePanel] Setting project dir to:', filePath)
    await sessionStore.setSessionProjectDir(props.sessionId, filePath)
    emit('update:workspacePath', filePath)
    console.log('[WorkspacePanel] Project dir set successfully')
  } catch (e) {
    console.error('[WorkspacePanel] Failed to set workspace from drop:', e)
  }
}

function hasDroppedFiles(event: DragEvent): boolean {
  if (event.dataTransfer?.types.includes('Files')) {
    return true
  }

  return Boolean(
    event.dataTransfer?.items &&
    Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')
  )
}

function getDroppedFile(event: DragEvent): File | null {
  const droppedFiles = event.dataTransfer?.files
  if (droppedFiles && droppedFiles.length > 0) {
    return droppedFiles[0] ?? null
  }

  const droppedItems = event.dataTransfer?.items
  if (!droppedItems || droppedItems.length === 0) {
    return null
  }

  for (const item of Array.from(droppedItems)) {
    if (item.kind !== 'file') {
      continue
    }

    const file = item.getAsFile()
    if (file) {
      return file
    }
  }

  return null
}

function getDroppedFilePath(file: File): string | null {
  const preloadPath = fileClient.getPathForFile(file).trim()
  if (preloadPath) {
    return preloadPath
  }

  const legacyPath = (file as File & { path?: string }).path?.trim()
  return legacyPath || null
}
</script>

<style scoped>
.workspace-nav {
  transition-duration: var(--dc-motion-default);
  transition-property: width;
  transition-timing-function: var(--dc-ease-out-express);
  will-change: width;
}

.workspace-nav--resizing {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .workspace-nav {
    transition: none;
  }
}
</style>
