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
        <h1 class="text-3xl font-semibold text-foreground mb-4">
          {{ t('chat.newThread.title') }}
        </h1>

        <!-- Project selector -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
            >
              <Icon icon="lucide:folder" class="w-3.5 h-3.5" />
              <span>{{ selectedProjectName }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" class="min-w-[200px]">
            <DropdownMenuLabel class="text-xs">{{ t('common.project.recent') }}</DropdownMenuLabel>
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
              <span>{{ t('common.project.openFolder') }}</span>
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
          :is-acp-session="isAcpSelectedAgent"
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
        <ChatStatusBar :acp-draft-session-id="acpDraftSessionId" />
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { useDraftStore, type StartDeeplinkPayload } from '@/stores/ui/draft'
import { usePresenter } from '@/composables/usePresenter'
import type {
  DeepChatAgentConfig,
  MessageFile,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'

const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const modelStore = useModelStore()
const draftStore = useDraftStore()
const configPresenter = usePresenter('configPresenter')
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const { t } = useI18n()

const message = ref('')
const attachedFiles = ref<MessageFile[]>([])
const pendingSkills = ref<string[]>([])
const chatInputRef = ref<{
  triggerAttach: () => void
  getPendingSkillsSnapshot?: () => string[]
} | null>(null)
const acpDraftSessionId = ref<string | null>(null)
const lastAcpDraftKey = ref<string | null>(null)
const acpDraftRequestSeq = ref(0)
let currentDraftDefaultsTask: Promise<void> | null = null
const availableAgents = computed(() => (Array.isArray(agentStore.agents) ? agentStore.agents : []))
const resolveAgentType = (agentId: string | null | undefined): 'deepchat' | 'acp' => {
  if (!agentId) {
    return 'deepchat'
  }

  const matchedAgent = availableAgents.value.find((agent) => agent.id === agentId)
  const selectedAgent =
    agentStore.selectedAgent && agentStore.selectedAgent.id === agentId
      ? agentStore.selectedAgent
      : null
  const explicitType = matchedAgent?.agentType ?? matchedAgent?.type ?? selectedAgent?.type
  if (explicitType === 'deepchat' || explicitType === 'acp') {
    return explicitType
  }

  return agentId === 'deepchat' ? 'deepchat' : 'acp'
}
const selectedAgent = computed(() => {
  const selectedAgentId = agentStore.selectedAgentId ?? 'deepchat'
  const matchedAgent = availableAgents.value.find((agent) => agent.id === selectedAgentId)
  if (matchedAgent) {
    return matchedAgent
  }

  if (agentStore.selectedAgent && agentStore.selectedAgent.id === selectedAgentId) {
    return agentStore.selectedAgent
  }

  return { id: selectedAgentId, type: resolveAgentType(selectedAgentId) }
})
const isAcpSelectedAgent = computed(() => selectedAgent.value.type === 'acp')
const normalizeProjectPath = (value: string | null | undefined) => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
const selectedProjectName = computed(
  () => projectStore.selectedProject?.name ?? t('common.project.select')
)
const isAcpWorkdirMissing = computed(() => {
  if (!isAcpSelectedAgent.value) {
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

  // 1. preferredModel (last user selection)
  const preferredModel = (await configPresenter.getSetting('preferredModel')) as
    | { providerId: string; modelId: string }
    | undefined
  const resolvedPreferredModel = getEnabledModel(
    preferredModel?.providerId,
    preferredModel?.modelId
  )
  if (resolvedPreferredModel) {
    return resolvedPreferredModel
  }

  // 2. defaultModel from settings
  const defaultModel = (await configPresenter.getSetting('defaultModel')) as
    | { providerId: string; modelId: string }
    | undefined
  const resolvedDefaultModel = getEnabledModel(defaultModel?.providerId, defaultModel?.modelId)
  if (resolvedDefaultModel) {
    return resolvedDefaultModel
  }

  // 3. First available enabled model
  for (const group of modelStore.enabledModels) {
    if (group.models.length > 0) {
      return { providerId: group.providerId, modelId: group.models[0].id }
    }
  }

  return null
}

const normalizeStartMention = (mention: string): string => {
  const normalized = mention.trim().replace(/^@+/, '')
  return normalized ? `@${normalized}` : ''
}

const buildStartMessage = (payload: StartDeeplinkPayload): string => {
  const mentionText = payload.mentions.map(normalizeStartMention).filter(Boolean).join(' ')
  return [payload.msg.trim(), mentionText].filter(Boolean).join(' ')
}

const resolveStartModelSelection = (
  requestedModelId: string | null
): { providerId: string; modelId: string } | null => {
  const normalizedModelId = requestedModelId?.trim().toLowerCase()
  if (!normalizedModelId) {
    return null
  }

  for (const group of modelStore.enabledModels) {
    const matched = group.models.find((model) => model.id.toLowerCase() === normalizedModelId)
    if (matched) {
      return { providerId: group.providerId, modelId: matched.id }
    }
  }

  for (const group of modelStore.enabledModels) {
    const matched = group.models.find((model) => model.id.toLowerCase().includes(normalizedModelId))
    if (matched) {
      return { providerId: group.providerId, modelId: matched.id }
    }
  }

  return null
}

const applyStartDeeplink = async (payload: StartDeeplinkPayload) => {
  const draftDefaultsTask = currentDraftDefaultsTask
  if (draftDefaultsTask) {
    await draftDefaultsTask
  }

  await nextTick()
  message.value = buildStartMessage(payload)
  draftStore.systemPrompt = payload.systemPrompt

  const matchedModel = resolveStartModelSelection(payload.modelId)
  if (matchedModel) {
    draftStore.providerId = matchedModel.providerId
    draftStore.modelId = matchedModel.modelId
  }

  draftStore.clearPendingStartDeeplink()
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

async function submitText(text: string, files: MessageFile[]) {
  if (!text.trim()) return

  const agentId = selectedAgent.value.id
  const isAcp = isAcpSelectedAgent.value
  const draftPermissionMode = draftStore.permissionMode
  const draftDisabledAgentTools = [...draftStore.disabledAgentTools]
  const draftSubagentEnabled = draftStore.subagentEnabled
  const draftGenerationSettings = draftStore.toGenerationSettings()
  if (isAcp && acpDraftSessionId.value) {
    await sessionStore.selectSession(acpDraftSessionId.value)
    await sessionStore.sendMessage(acpDraftSessionId.value, {
      text,
      files
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
    files,
    projectDir: projectStore.selectedProject?.path,
    agentId,
    providerId,
    modelId,
    permissionMode: draftPermissionMode,
    disabledAgentTools: isAcp ? undefined : draftDisabledAgentTools,
    subagentEnabled: isAcp ? false : draftSubagentEnabled,
    generationSettings: draftGenerationSettings,
    activeSkills: dedupedPendingSkills.length > 0 ? dedupedPendingSkills : undefined
  })
}

const buildDraftGenerationSettings = (
  config: DeepChatAgentConfig
): Partial<SessionGenerationSettings> => {
  return {
    systemPrompt: config.systemPrompt ?? ''
  }
}

const resolveDeepChatAgentConfig = async (agentId: string): Promise<DeepChatAgentConfig> => {
  if (typeof configPresenter.resolveDeepChatAgentConfig === 'function') {
    return configPresenter.resolveDeepChatAgentConfig(agentId)
  }

  const systemPrompt = await configPresenter.getSetting?.('default_system_prompt')

  return normalizeDeepChatSubagentConfig({
    defaultModelPreset: undefined,
    systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
    permissionMode: 'full_access',
    disabledAgentTools: []
  })
}

const applyDraftDefaultsForSelectedAgent = async (): Promise<void> => {
  const agentId = selectedAgent.value.id
  const globalDefaultProjectPath = normalizeProjectPath(projectStore.defaultProjectPath)
  const currentProjectPath = normalizeProjectPath(projectStore.selectedProject?.path)
  draftStore.agentId = agentId
  draftStore.providerId = undefined
  draftStore.modelId = undefined
  draftStore.permissionMode = 'full_access'
  draftStore.disabledAgentTools = []
  draftStore.subagentEnabled = false
  draftStore.systemPrompt = undefined
  draftStore.temperature = undefined
  draftStore.contextLength = undefined
  draftStore.maxTokens = undefined
  draftStore.thinkingBudget = undefined
  draftStore.reasoningEffort = undefined
  draftStore.verbosity = undefined
  draftStore.forceInterleavedThinkingCompat = undefined

  if (selectedAgent.value.type === 'acp') {
    const resolvedProjectPath = currentProjectPath ?? globalDefaultProjectPath
    if (!currentProjectPath && globalDefaultProjectPath) {
      projectStore.selectProject(globalDefaultProjectPath, 'default')
    }
    draftStore.projectDir = resolvedProjectPath ?? undefined
    draftStore.providerId = 'acp'
    draftStore.modelId = agentId
    draftStore.permissionMode = 'full_access'
    draftStore.disabledAgentTools = []
    draftStore.subagentEnabled = false
    return
  }

  const config = await resolveDeepChatAgentConfig(agentId)
  const agentDefaultProjectPath = normalizeProjectPath(config.defaultProjectPath)
  const resolvedProjectPath =
    agentDefaultProjectPath ?? currentProjectPath ?? globalDefaultProjectPath
  if (agentDefaultProjectPath) {
    projectStore.selectProject(
      agentDefaultProjectPath,
      agentDefaultProjectPath === globalDefaultProjectPath ? 'default' : 'manual'
    )
  } else if (!currentProjectPath && globalDefaultProjectPath) {
    projectStore.selectProject(globalDefaultProjectPath, 'default')
  }
  draftStore.projectDir = resolvedProjectPath ?? undefined
  draftStore.providerId = config.defaultModelPreset?.providerId
  draftStore.modelId = config.defaultModelPreset?.modelId
  draftStore.permissionMode = config.permissionMode === 'default' ? 'default' : 'full_access'
  draftStore.disabledAgentTools = [...(config.disabledAgentTools ?? [])]
  draftStore.subagentEnabled = config.subagentEnabled === true
  Object.assign(draftStore, buildDraftGenerationSettings(config))
}

function onAttach() {
  chatInputRef.value?.triggerAttach()
}

function onFilesChange(files: MessageFile[]) {
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
    const session = await agentSessionPresenter.ensureAcpDraftSession({
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
    if (!selectedAgentId || selectedAgent.value.type === 'deepchat' || !projectPath?.trim()) {
      acpDraftSessionId.value = null
      lastAcpDraftKey.value = null
      return
    }
    void ensureAcpDraftSession(selectedAgentId, projectPath)
  },
  { immediate: true }
)

watch(
  () => [selectedAgent.value.id, selectedAgent.value.type] as const,
  () => {
    const task = applyDraftDefaultsForSelectedAgent().finally(() => {
      if (currentDraftDefaultsTask === task) {
        currentDraftDefaultsTask = null
      }
    })
    currentDraftDefaultsTask = task
  },
  { immediate: true }
)

watch(
  () => projectStore.selectedProject?.path,
  (projectDir) => {
    draftStore.projectDir = projectDir
  },
  { immediate: true }
)

watch(
  () => draftStore.pendingStartDeeplink?.token ?? 0,
  () => {
    const pendingStartDeeplink = draftStore.pendingStartDeeplink
    if (!pendingStartDeeplink) {
      return
    }
    void applyStartDeeplink(pendingStartDeeplink)
  },
  { immediate: true }
)

onMounted(() => {
  draftStore.projectDir = projectStore.selectedProject?.path
})
</script>
