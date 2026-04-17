<template>
  <div class="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
    <aside class="flex h-full min-h-0 w-[224px] shrink-0 flex-col border-r bg-muted/20">
      <div class="flex-1 overflow-auto py-2">
        <section>
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
            type="button"
            @click="sidepanelStore.toggleSection(props.sessionId, 'files')"
          >
            <Icon icon="lucide:folder-tree" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="flex-1 truncate">{{ t('chat.workspace.sections.files') }}</span>
            <Icon
              :icon="sessionState.sections.files ? 'lucide:chevron-down' : 'lucide:chevron-right'"
              class="h-3.5 w-3.5 text-muted-foreground"
            />
          </button>
          <div v-if="sessionState.sections.files" class="pb-2">
            <div
              v-if="!props.workspacePath"
              class="mx-2 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-4 text-center"
              :class="{ 'border-primary bg-primary/5': isDragging }"
              @dragenter.prevent="isDragging = true"
              @dragover.prevent="handleDragOver"
              @dragleave="handleDragLeave"
              @drop.prevent="handleDrop"
            >
              <Icon icon="lucide:folder-plus" class="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
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
            />
          </div>
        </section>

        <section v-if="gitState">
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
            type="button"
            @click="sidepanelStore.toggleSection(props.sessionId, 'git')"
          >
            <Icon icon="lucide:git-branch" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="flex-1 truncate">{{ t('chat.workspace.sections.git') }}</span>
            <span class="text-[11px] text-muted-foreground">{{ gitState.changes.length }}</span>
            <Icon
              :icon="sessionState.sections.git ? 'lucide:chevron-down' : 'lucide:chevron-right'"
              class="h-3.5 w-3.5 text-muted-foreground"
            />
          </button>
          <div v-if="sessionState.sections.git" class="pb-2">
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
            @click="sidepanelStore.toggleSection(props.sessionId, 'artifacts')"
          >
            <Icon icon="lucide:box" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="flex-1 truncate">{{ t('chat.workspace.sections.artifacts') }}</span>
            <span class="text-[11px] text-muted-foreground">{{ artifactItems.length }}</span>
            <Icon
              :icon="
                sessionState.sections.artifacts ? 'lucide:chevron-down' : 'lucide:chevron-right'
              "
              class="h-3.5 w-3.5 text-muted-foreground"
            />
          </button>
          <div v-if="sessionState.sections.artifacts" class="pb-2">
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
    </aside>

    <WorkspaceViewer
      :session-id="props.sessionId"
      :artifact="selectedArtifact"
      :file-preview="selectedFilePreview"
      :git-diff="selectedGitDiff"
      :loading-file-preview="loadingFilePreview"
      :loading-git-diff="loadingGitDiff"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { extractArtifactsFromContent } from '@/composables/useArtifacts'
import WorkspaceFileNode from '@/components/workspace/WorkspaceFileNode.vue'
import WorkspaceViewer from './WorkspaceViewer.vue'
import { useWorkspaceSync } from './composables/useWorkspaceSync'
import { useArtifactStore } from '@/stores/artifact'
import { useMessageStore } from '@/stores/ui/message'
import { useSidepanelStore, type WorkspaceArtifactContext } from '@/stores/ui/sidepanel'
import { useSessionStore } from '@/stores/ui/session'
import type { WorkspaceGitFileChange } from '@shared/presenter'

const props = defineProps<{
  sessionId: string
  workspacePath: string | null
}>()

const emit = defineEmits<{
  'update:workspacePath': [path: string | null]
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
const workspacePresenter = usePresenter('workspacePresenter')
const projectPresenter = usePresenter('projectPresenter')
const filePresenter = usePresenter('filePresenter')

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
  workspacePresenter,
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

const handleFileSelect = (filePath: string) => {
  sidepanelStore.selectFile(props.sessionId, filePath, {
    open: false,
    viewMode: 'preview'
  })
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
    const selectedPath = await projectPresenter.selectDirectory()
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
  if (!relatedTarget || !(event.currentTarget instanceof Node) || !event.currentTarget.contains(relatedTarget as Node)) {
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
    const isDirectory = await filePresenter.isDirectory(filePath)
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
  const preloadPath = window.api?.getPathForFile?.(file)?.trim()
  if (preloadPath) {
    return preloadPath
  }

  const legacyPath = (file as File & { path?: string }).path?.trim()
  return legacyPath || null
}
</script>
