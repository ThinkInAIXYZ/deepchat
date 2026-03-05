<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full w-full flex flex-col">
      <!-- Main content area (centered) -->
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <!-- Logo -->
        <div class="mb-4">
          <img src="@/assets/logo-dark.png" class="w-14 h-14" loading="lazy" />
        </div>

        <!-- Heading -->
        <h1 class="text-3xl font-semibold text-foreground mb-4">Build and explore</h1>

        <!-- Project selector -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
            >
              <Icon icon="lucide:folder" class="w-3.5 h-3.5" />
              <span>{{ projectStore.selectedProjectName }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" class="min-w-[200px]">
            <DropdownMenuLabel class="text-xs">Recent Projects</DropdownMenuLabel>
            <DropdownMenuItem
              v-for="project in projectStore.projects"
              :key="project.path"
              class="gap-2 text-xs py-1.5 px-2"
              @click="projectStore.selectProject(project.path)"
            >
              <Icon icon="lucide:folder" class="w-3.5 h-3.5 text-muted-foreground" />
              <div class="flex flex-col min-w-0">
                <span class="truncate">{{ project.name }}</span>
                <span class="text-[10px] text-muted-foreground truncate">{{ project.path }}</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="gap-2 text-xs py-1.5 px-2"
              @click="projectStore.openFolderPicker()"
            >
              <Icon icon="lucide:folder-open" class="w-3.5 h-3.5 text-muted-foreground" />
              <span>Open folder...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Input area -->
        <ChatInputBox
          ref="chatInputRef"
          v-model="message"
          :files="attachedFiles"
          :session-id="acpDraftSessionId"
          :workspace-path="projectStore.selectedProject?.path ?? null"
          :is-acp-session="(agentStore.selectedAgentId ?? 'deepchat') !== 'deepchat'"
          :submit-disabled="isAcpWorkdirMissing"
          @update:files="onFilesChange"
          @pending-skills-change="onPendingSkillsChange"
          @command-submit="onCommandSubmit"
          @submit="onSubmit"
        >
          <template #toolbar>
            <ChatInputToolbar
              :send-disabled="isAcpWorkdirMissing || !message.trim()"
              @attach="onAttach"
              @send="onSubmit"
            />
          </template>
        </ChatInputBox>

        <!-- Status bar -->
        <ChatStatusBar />
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Icon } from '@iconify/vue'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import { useProjectStore } from '@/stores/ui/project'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useModelStore } from '@/stores/modelStore'
import { useDraftStore } from '@/stores/ui/draft'
import { usePresenter } from '@/composables/usePresenter'
import type { MessageFile as ChatMessageFile } from '@shared/chat'
import type { MessageFile as AgentMessageFile } from '@shared/types/agent-interface'

const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const modelStore = useModelStore()
const draftStore = useDraftStore()
const configPresenter = usePresenter('configPresenter')
const newAgentPresenter = usePresenter('newAgentPresenter')

const message = ref('')
const attachedFiles = ref<ChatMessageFile[]>([])
const pendingSkills = ref<string[]>([])
const chatInputRef = ref<{
  triggerAttach: () => void
  getPendingSkillsSnapshot?: () => string[]
} | null>(null)
const acpDraftSessionId = ref<string | null>(null)
const lastAcpDraftKey = ref<string | null>(null)
const acpDraftRequestSeq = ref(0)
const isAcpWorkdirMissing = computed(() => {
  const selectedAgentId = agentStore.selectedAgentId ?? 'deepchat'
  if (selectedAgentId === 'deepchat') {
    return false
  }
  return !projectStore.selectedProject?.path?.trim()
})

const getEnabledModel = (
  providerId?: string,
  modelId?: string
): { providerId: string; modelId: string } | null => {
  if (!providerId || !modelId) return null
  const matched = modelStore.enabledModels.some(
    (group) => group.providerId === providerId && group.models.some((model) => model.id === modelId)
  )
  return matched ? { providerId, modelId } : null
}

async function resolveModel(): Promise<{ providerId: string; modelId: string } | null> {
  // 0. model manually selected in current NewThread page
  const draftModel = getEnabledModel(draftStore.providerId, draftStore.modelId)
  if (draftModel) {
    return draftModel
  }

  // 1. defaultModel from settings
  const defaultModel = (await configPresenter.getSetting('defaultModel')) as
    | { providerId: string; modelId: string }
    | undefined
  if (defaultModel?.providerId && defaultModel?.modelId) return defaultModel

  // 2. preferredModel (last user selection)
  const preferred = (await configPresenter.getSetting('preferredModel')) as
    | { providerId: string; modelId: string }
    | undefined
  if (preferred?.providerId && preferred?.modelId) return preferred

  // 3. First available enabled model
  for (const group of modelStore.enabledModels) {
    if (group.models.length > 0) {
      return { providerId: group.providerId, modelId: group.models[0].id }
    }
  }

  return null
}

async function onSubmit() {
  if (isAcpWorkdirMissing.value) return

  const text = message.value.trim()
  if (!text) return
  const files = [...attachedFiles.value]
  message.value = ''
  attachedFiles.value = []

  await submitText(text, files)
}

async function onCommandSubmit(command: string) {
  if (isAcpWorkdirMissing.value) return
  const text = command.trim()
  if (!text) return
  const files = [...attachedFiles.value]
  attachedFiles.value = []
  await submitText(text, files)
}

const toAgentMessageFiles = (files: ChatMessageFile[]): AgentMessageFile[] =>
  files.map((file) => ({
    ...file,
    metadata: file.metadata
      ? {
          ...file.metadata,
          fileCreated: file.metadata.fileCreated
            ? new Date(file.metadata.fileCreated as Date | string | number)
            : undefined,
          fileModified: file.metadata.fileModified
            ? new Date(file.metadata.fileModified as Date | string | number)
            : undefined
        }
      : undefined
  }))

async function submitText(text: string, files: ChatMessageFile[]) {
  if (!text.trim()) return

  const agentId = agentStore.selectedAgentId ?? 'deepchat'
  const isAcp = agentId !== 'deepchat'
  const normalizedFiles = toAgentMessageFiles(files)

  if (isAcp && acpDraftSessionId.value) {
    await sessionStore.selectSession(acpDraftSessionId.value)
    await sessionStore.sendMessage(acpDraftSessionId.value, {
      text,
      files: normalizedFiles
    })
    return
  }

  let providerId: string | undefined
  let modelId: string | undefined

  if (isAcp) {
    providerId = 'acp'
    modelId = agentId
  } else {
    const resolved = await resolveModel()
    if (!resolved) {
      console.error('No model available. Please configure a provider and model in settings.')
      return
    }
    providerId = resolved.providerId
    modelId = resolved.modelId
  }

  const pendingSkillsSnapshot =
    chatInputRef.value?.getPendingSkillsSnapshot?.() ?? pendingSkills.value
  const dedupedPendingSkills = Array.from(new Set(pendingSkillsSnapshot))

  await sessionStore.createSession({
    message: text,
    files: normalizedFiles,
    projectDir: projectStore.selectedProject?.path,
    agentId,
    providerId,
    modelId,
    permissionMode: draftStore.permissionMode,
    generationSettings: draftStore.toGenerationSettings(),
    activeSkills: dedupedPendingSkills.length > 0 ? dedupedPendingSkills : undefined
  })
}

function onAttach() {
  chatInputRef.value?.triggerAttach()
}

function onFilesChange(files: ChatMessageFile[]) {
  attachedFiles.value = files
}

function onPendingSkillsChange(skills: string[]) {
  pendingSkills.value = [...skills]
}

const ensureAcpDraftSession = async (agentId: string, projectPath: string) => {
  const projectDir = projectPath.trim()
  if (!projectDir) return

  const draftKey = `${agentId}::${projectDir}`
  if (lastAcpDraftKey.value === draftKey && acpDraftSessionId.value) {
    return
  }
  if (lastAcpDraftKey.value !== draftKey) {
    acpDraftSessionId.value = null
    lastAcpDraftKey.value = null
  }

  const requestSeq = ++acpDraftRequestSeq.value

  try {
    const session = await newAgentPresenter.ensureAcpDraftSession({
      agentId,
      projectDir,
      permissionMode: draftStore.permissionMode
    })
    if (requestSeq !== acpDraftRequestSeq.value) {
      return
    }
    const currentAgentId = agentStore.selectedAgentId
    const currentProjectDir = projectStore.selectedProject?.path?.trim()
    if (currentAgentId !== agentId || currentProjectDir !== projectDir) {
      return
    }
    const sessionId = typeof session?.id === 'string' ? session.id.trim() : ''
    if (!sessionId) {
      console.warn('[NewThreadPage] ensureAcpDraftSession returned invalid session:', session)
      acpDraftSessionId.value = null
      lastAcpDraftKey.value = null
      return
    }
    acpDraftSessionId.value = sessionId
    lastAcpDraftKey.value = draftKey
  } catch (error) {
    if (requestSeq !== acpDraftRequestSeq.value) {
      return
    }
    console.warn('[NewThreadPage] Failed to ensure ACP draft session:', error)
    acpDraftSessionId.value = null
    lastAcpDraftKey.value = null
  }
}

watch(
  () => [agentStore.selectedAgentId, projectStore.selectedProject?.path] as const,
  ([selectedAgentId, projectPath]) => {
    acpDraftRequestSeq.value += 1
    if (!selectedAgentId || selectedAgentId === 'deepchat' || !projectPath?.trim()) {
      acpDraftSessionId.value = null
      lastAcpDraftKey.value = null
      return
    }
    void ensureAcpDraftSession(selectedAgentId, projectPath)
  },
  { immediate: true }
)

onMounted(() => {
  // Keep new-thread selection page-scoped: start each NewThread page with no manual override.
  draftStore.providerId = undefined
  draftStore.modelId = undefined
  draftStore.permissionMode = 'full_access'
  draftStore.resetGenerationSettings()
})
</script>
