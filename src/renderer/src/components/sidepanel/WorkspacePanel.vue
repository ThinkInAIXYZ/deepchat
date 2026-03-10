<template>
  <div class="flex h-full min-w-0 flex-1 overflow-hidden">
    <aside class="flex h-full w-[224px] shrink-0 flex-col border-r bg-muted/20">
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
            <div v-if="!props.workspacePath" class="px-3 py-2 text-[11px] text-muted-foreground/70">
              {{ t('chat.workspace.files.empty') }}
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
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { extractArtifactsFromContent } from '@/composables/useArtifacts'
import WorkspaceFileNode from '@/components/workspace/WorkspaceFileNode.vue'
import WorkspaceViewer from './WorkspaceViewer.vue'
import { useArtifactStore } from '@/stores/artifact'
import { useMessageStore } from '@/stores/ui/message'
import { useSidepanelStore, type WorkspaceArtifactContext } from '@/stores/ui/sidepanel'
import type {
  WorkspaceFileNode as WorkspaceTreeNode,
  WorkspaceFilePreview,
  WorkspaceGitDiff,
  WorkspaceGitFileChange,
  WorkspaceGitState
} from '@shared/presenter'
import type { AssistantMessageBlock } from '@shared/chat'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

const props = defineProps<{
  sessionId: string
  workspacePath: string | null
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
const workspacePresenter = usePresenter('workspacePresenter')

const fileTree = ref<WorkspaceTreeNode[]>([])
const selectedFilePreview = ref<WorkspaceFilePreview | null>(null)
const selectedGitDiff = ref<WorkspaceGitDiff | null>(null)
const gitState = ref<WorkspaceGitState | null>(null)
const loadingFiles = ref(false)
const loadingFilePreview = ref(false)
const loadingGitDiff = ref(false)

const sessionState = computed(() => sidepanelStore.getSessionState(props.sessionId))

const parseAssistantBlocks = (record: ChatMessageRecord) => {
  try {
    return JSON.parse(record.content) as Array<Pick<AssistantMessageBlock, 'content' | 'status'>>
  } catch {
    return []
  }
}

const artifactItems = computed<ArtifactItem[]>(() => {
  const items: ArtifactItem[] = []

  for (const message of messageStore.messages) {
    if (message.sessionId !== props.sessionId || message.role !== 'assistant') {
      continue
    }

    for (const block of parseAssistantBlocks(message)) {
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

const loadWorkspace = async (workspacePath: string | null) => {
  fileTree.value = []
  gitState.value = null
  selectedFilePreview.value = null
  selectedGitDiff.value = null

  if (!workspacePath) {
    return
  }

  loadingFiles.value = true
  try {
    await workspacePresenter.registerWorkspace(workspacePath)
    fileTree.value = (await workspacePresenter.readDirectory(workspacePath)) ?? []
    gitState.value = await workspacePresenter.getGitStatus(workspacePath)
  } finally {
    loadingFiles.value = false
  }
}

watch(
  () => props.workspacePath,
  (workspacePath) => {
    void loadWorkspace(workspacePath)
  },
  { immediate: true }
)

watch(
  () => sessionState.value.selectedFilePath,
  async (filePath) => {
    selectedFilePreview.value = null
    if (!filePath) {
      return
    }

    loadingFilePreview.value = true
    try {
      selectedFilePreview.value = await workspacePresenter.readFilePreview(filePath)
    } finally {
      loadingFilePreview.value = false
    }
  },
  { immediate: true }
)

watch(
  () => sessionState.value.selectedDiffPath,
  async (filePath) => {
    selectedGitDiff.value = null
    if (!filePath || !props.workspacePath) {
      return
    }

    loadingGitDiff.value = true
    try {
      selectedGitDiff.value = await workspacePresenter.getGitDiff(props.workspacePath, filePath)
    } finally {
      loadingGitDiff.value = false
    }
  },
  { immediate: true }
)

watch(
  [artifactItems, () => sessionState.value.selectedArtifactContext] as const,
  ([items, context]) => {
    if (!context) {
      return
    }

    const exists = items.some(
      (item) =>
        item.threadId === context.threadId &&
        item.messageId === context.messageId &&
        item.artifactId === context.artifactId
    )

    if (!exists) {
      sidepanelStore.clearArtifact(props.sessionId)
    }
  },
  { immediate: true }
)

watch(
  [gitState, () => sessionState.value.selectedDiffPath] as const,
  ([state, selectedDiffPath]) => {
    if (!selectedDiffPath) {
      return
    }

    const exists = Boolean(state?.changes.some((change) => change.path === selectedDiffPath))
    if (!exists) {
      sidepanelStore.clearDiff(props.sessionId)
      selectedGitDiff.value = null
    }
  },
  { immediate: true }
)

const toggleNode = async (node: WorkspaceTreeNode) => {
  if (!node.isDirectory) {
    return
  }

  if (node.expanded) {
    node.expanded = false
    return
  }

  if (!node.children) {
    node.children = (await workspacePresenter.expandDirectory(node.path)) ?? []
  }

  node.expanded = true
}

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
</script>
