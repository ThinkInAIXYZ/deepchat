<template>
  <TooltipProvider :delay-duration="200">
    <div
      ref="guideRootRef"
      data-testid="new-thread-page"
      class="relative h-full w-full flex flex-col"
    >
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
              data-testid="new-thread-project-trigger"
              class="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
            >
              <Icon
                :icon="selectedProjectIcon"
                :data-icon="selectedProjectIcon"
                data-testid="new-thread-project-trigger-icon"
                class="w-3.5 h-3.5"
              />
              <span>{{ selectedProjectName }}</span>
              <Icon
                v-if="selectedProjectDirectoryInvalid"
                icon="lucide:circle-alert"
                data-testid="new-thread-project-missing-warning"
                class="w-3.5 h-3.5 text-amber-500"
                :title="selectedProjectUnavailableTooltip"
              />
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            class="min-w-[200px] max-h-[min(28rem,calc(var(--reka-dropdown-menu-content-available-height)-0.75rem))] overflow-y-auto"
          >
            <DropdownMenuLabel class="text-xs">{{ t('common.project.recent') }}</DropdownMenuLabel>
            <DropdownMenuItem
              data-testid="new-thread-clear-project"
              class="gap-2 text-xs py-1.5 px-2"
              :disabled="!canClearProjectSelection"
              @click="clearSelectedProject"
            >
              <Icon
                :icon="chatProjectIcon"
                :data-icon="chatProjectIcon"
                data-testid="new-thread-clear-project-icon"
                class="w-3.5 h-3.5 text-muted-foreground"
              />
              <span>{{ t('chat.sidebar.chats') }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              v-for="project in selectableProjects"
              :key="project.path"
              class="gap-2 text-xs py-1.5 px-2"
              @click="projectStore.selectProject(project.path)"
            >
              <Icon
                :icon="getProjectMenuIcon(project.path)"
                class="w-3.5 h-3.5 text-muted-foreground"
              />
              <div class="flex flex-col min-w-0 flex-1">
                <span class="truncate">{{ getProjectDisplayName(project) }}</span>
                <span class="text-[10px] text-muted-foreground truncate">{{ project.path }}</span>
              </div>
              <Icon
                v-if="isSelectedInvalidProjectPath(project.path)"
                icon="lucide:circle-alert"
                data-testid="new-thread-project-menu-missing-warning"
                class="w-3.5 h-3.5 text-amber-500 shrink-0"
                :title="selectedProjectUnavailableTooltip"
              />
            </DropdownMenuItem>
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
        <div ref="firstChatGuideHostRef" :class="['w-full max-w-4xl flex justify-center']">
          <ChatInputBox
            ref="chatInputRef"
            :class="activeChatGuide?.key === 'first-chat' ? 'relative z-30 rounded-2xl' : ''"
            v-model="message"
            :files="attachedFiles"
            :session-id="acpDraftSessionId"
            :workspace-path="projectStore.selectedProject?.path ?? null"
            :is-acp-session="isAcpSelectedAgent"
            :submit-disabled="isAcpWorkdirUnavailable"
            @update:files="onFilesChange"
            @pending-skills-change="onPendingSkillsChange"
            @command-submit="onCommandSubmit"
            @submit="onSubmit"
            @toggle-voice-input="onToggleVoiceInput"
          >
            <template #toolbar>
              <ChatInputToolbar
                :show-voice-input="isVoiceInputEnabled"
                :is-voice-input-listening="isVoiceInputListening"
                :is-voice-input-transcribing="isVoiceInputTranscribing"
                :send-disabled="isAcpWorkdirUnavailable || !message.trim()"
                @attach="onAttach"
                @voice-input="onToggleVoiceInput"
                @send="onSubmit"
              />
            </template>
          </ChatInputBox>
        </div>

        <!-- Status bar -->
        <ChatStatusBar :acp-draft-session-id="acpDraftSessionId" />
      </div>

      <GuidedOnboardingOverlay
        :visible="Boolean(activeChatGuide?.targetEl)"
        :container-el="guideRootRef"
        :target-el="activeChatGuide?.targetEl ?? null"
        :preferred-panel-placement="activeChatGuide?.preferredPanelPlacement ?? 'auto'"
        :eyebrow="t('welcome.page.guide.title')"
        :title="activeChatGuide?.title ?? ''"
        :description="activeChatGuide?.description ?? ''"
        :caption="activeChatGuide?.caption"
        :step-index="activeChatGuide?.stepIndex ?? 1"
        :total-steps="activeChatGuide?.totalSteps ?? 1"
        :close-label="t('common.close')"
        :back-label="activeChatGuide ? t('common.back') : undefined"
        :expert-label="activeChatGuide ? t('settings.skills.sync.skipAll') : undefined"
        :primary-label="activeChatGuidePrimaryLabel"
        :primary-disabled="activeChatGuidePrimaryDisabled"
        @close="activeChatGuide?.dismiss()"
        @back="handleActiveChatGuideBack"
        @expert="handleActiveChatGuideExpert"
        @primary="handleActiveChatGuidePrimary"
      />
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { persistGuidedOnboardingResumeIntent } from '@/lib/onboardingResume'
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
import { useToast } from '@/components/use-toast'
import { useProjectStore } from '@/stores/ui/project'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useModelStore } from '@/stores/modelStore'
import { useDraftStore, type StartDeeplinkPayload } from '@/stores/ui/draft'
import { createConfigClient } from '@api/ConfigClient'
import { createFileClient } from '@api/FileClient'
import { createModelClient } from '@api/ModelClient'
import { createSessionClient } from '@api/SessionClient'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import type {
  DeepChatAgentConfig,
  MessageFile,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import { normalizeDeepChatSubagentConfig } from '@shared/lib/deepchatSubagents'
import {
  resolveChatModelByQuery,
  resolvePreferredChatModel,
  type ChatModelSelection
} from '@/lib/chatModelSelection'
import { scheduleStartupDeferredTask } from '@/lib/startupDeferred'
import { isManualCompactionCommand } from '@/components/chat/mentions/utils'
import { filterUnsupportedAudioAttachments } from '@/lib/audioInputSupport'
import { useSpeechRecognition } from '@/components/chat/composables/useSpeechRecognition'
import { cancelChatInputHeroFlight, prepareChatInputHeroFlight } from '@/lib/chatInputHero'

const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const modelStore = useModelStore()
const draftStore = useDraftStore()
const configClient = createConfigClient()
const fileClient = createFileClient()
const modelClient = createModelClient()
const sessionClient = createSessionClient()
const { t } = useI18n()
const { toast } = useToast()
const switchAgentGuide = useGuidedOnboardingStep('switch-agent')
const switchModelGuide = useGuidedOnboardingStep('switch-model')
const firstChatGuide = useGuidedOnboardingStep('first-chat')

type SubmissionModelSelection = { providerId: string; modelId: string }

const message = ref('')
const attachedFiles = ref<MessageFile[]>([])
const pendingSkills = ref<string[]>([])
const guideRootRef = ref<HTMLElement | null>(null)
const agentGuideTargetRef = ref<HTMLElement | null>(null)
const modelGuideTargetRef = ref<HTMLElement | null>(null)
const firstChatGuideHostRef = ref<HTMLElement | null>(null)
const firstChatGuideTargetRef = ref<HTMLElement | null>(null)
const isVoiceInputEnabled = ref(false)
const chatInputRef = ref<{
  triggerAttach: () => void
  insertRecognizedText?: (text: string) => void
  getPendingSkillsSnapshot?: () => string[]
  clearPendingSkills?: () => void
  focusInput?: () => void
} | null>(null)
const acpDraftSessionId = ref<string | null>(null)
const acpDraftModelSelection = ref<SubmissionModelSelection | null>(null)
const lastAcpDraftKey = ref<string | null>(null)
const acpDraftRequestSeq = ref(0)
const isCompletingSwitchAgentGuide = ref(false)
let currentDraftDefaultsTask: Promise<void> | null = null
let cancelEnsureDraftTask: (() => void) | null = null
let voiceInputConfigToken = 0
let attachmentFilterToken = 0
const availableAgents = computed(() => (Array.isArray(agentStore.agents) ? agentStore.agents : []))

const resolveChatInputBoxElement = () =>
  (firstChatGuideHostRef.value?.querySelector(
    '[data-testid="chat-input-box"]'
  ) as HTMLElement | null) ?? null

const handleVoiceInputError = (code: string) => {
  if (code === 'aborted') {
    return
  }

  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
    toast({
      title: t('chat.input.voiceRecognitionPermissionDeniedTitle'),
      description: t('chat.input.voiceRecognitionPermissionDeniedDescription'),
      variant: 'destructive'
    })
    return
  }

  toast({
    title: t('chat.input.voiceRecognitionErrorTitle'),
    description: t('chat.input.voiceRecognitionErrorDescription'),
    variant: 'destructive'
  })
}

const voiceInput = useSpeechRecognition({
  onTranscript: (text) => {
    chatInputRef.value?.insertRecognizedText?.(text)
  },
  transcribe: async ({ audioBase64, mimeType, filename }) => {
    const explicitSelection = resolveVoiceInputSelection()
    const selection = explicitSelection ?? (modelStore.initialized ? await resolveModel() : null)
    if (!selection) {
      throw new Error('transcription-target-unavailable')
    }

    return await modelClient.transcribeAudio(
      selection.providerId,
      selection.modelId,
      audioBase64,
      mimeType,
      filename
    )
  },
  onUnsupported: () => {
    toast({
      title: t('chat.input.voiceRecognitionUnsupportedTitle'),
      description: t('chat.input.voiceRecognitionUnsupportedDescription'),
      variant: 'destructive'
    })
  },
  onError: handleVoiceInputError
})
const isVoiceInputListening = computed(() => voiceInput.isListening.value)
const isVoiceInputTranscribing = computed(() => voiceInput.isTranscribing.value)
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
const isDeepChatSelectedAgent = computed(() => selectedAgent.value.type === 'deepchat')
const normalizeProjectPath = (value: string | null | undefined) => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
const normalizeComparableProjectPath = (value: string | null | undefined) =>
  normalizeProjectPath(value)?.replace(/[\\/]+$/, '') ?? null
const isDefaultChatWorkspaceProject = (path: string | null | undefined) => {
  const chatWorkspacePath = normalizeComparableProjectPath(projectStore.defaultChatWorkspacePath)
  return Boolean(chatWorkspacePath) && normalizeComparableProjectPath(path) === chatWorkspacePath
}
const selectedProjectPath = computed(() => normalizeProjectPath(projectStore.selectedProject?.path))
const archivedProjectPaths = computed(
  () => new Set(projectStore.archivedEnvironments.map((environment) => environment.path))
)
const removedProjectPaths = computed(
  () => new Set(projectStore.removedEnvironments.map((environment) => environment.path))
)
const missingProjectPaths = computed(
  () =>
    new Set(
      projectStore.environments
        .filter((environment) => !environment.exists)
        .map((environment) => environment.path)
    )
)
const selectableProjects = computed(() =>
  projectStore.projects.filter(
    (project) =>
      project.exists &&
      !archivedProjectPaths.value.has(project.path) &&
      !removedProjectPaths.value.has(project.path) &&
      !missingProjectPaths.value.has(project.path) &&
      !isSelectedInvalidProjectPath(project.path)
  )
)
const hasExplicitNoProjectSelection = computed(
  () => projectStore.selectionSource === 'manual' && !projectStore.selectedProject?.path?.trim()
)
const selectedSessionProjectDir = computed<string | null | undefined>(() =>
  hasExplicitNoProjectSelection.value ? null : projectStore.selectedProject?.path
)
const isSelectedChatProject = computed(
  () =>
    hasExplicitNoProjectSelection.value ||
    isDefaultChatWorkspaceProject(projectStore.selectedProject?.path)
)
const chatProjectIcon = 'lucide:message-square'
const selectedProjectName = computed(() => {
  if (isDefaultChatWorkspaceProject(projectStore.selectedProject?.path)) {
    return t('chat.sidebar.chats')
  }
  if (projectStore.selectedProject?.name) {
    return projectStore.selectedProject.name
  }
  return hasExplicitNoProjectSelection.value ? t('chat.sidebar.chats') : t('common.project.select')
})
const selectedProjectIcon = computed(() =>
  isSelectedChatProject.value ? chatProjectIcon : 'lucide:folder'
)
const getProjectDisplayName = (project: { path: string; name: string }) =>
  isDefaultChatWorkspaceProject(project.path) ? t('chat.sidebar.chats') : project.name
const getProjectMenuIcon = (projectPath: string) =>
  isDefaultChatWorkspaceProject(projectPath) ? chatProjectIcon : 'lucide:folder'
const canClearProjectSelection = computed(() => Boolean(projectStore.selectedProject?.path?.trim()))
type ProjectDirectoryStatus = 'none' | 'checking' | 'valid' | 'invalid'
const selectedProjectDirectoryStatus = ref<ProjectDirectoryStatus>('none')
const selectedProjectDirectoryCheckSeq = ref(0)
const selectedProjectDirectoryInvalid = computed(
  () => selectedProjectDirectoryStatus.value === 'invalid'
)
const selectedProjectUnavailableTooltip = computed(() =>
  selectedProjectPath.value
    ? t('chat.input.workspaceUnavailableTooltip', { path: selectedProjectPath.value })
    : ''
)
const isSelectedInvalidProjectPath = (projectPath: string | null | undefined): boolean =>
  selectedProjectDirectoryInvalid.value &&
  normalizeProjectPath(projectPath) === selectedProjectPath.value
const isAcpWorkdirMissing = computed(() => {
  if (!isAcpSelectedAgent.value) {
    return false
  }
  return !selectedProjectPath.value
})
const isAcpWorkdirInvalid = computed(
  () =>
    isAcpSelectedAgent.value &&
    Boolean(selectedProjectPath.value) &&
    selectedProjectDirectoryInvalid.value
)
const isAcpWorkdirChecking = computed(
  () =>
    isAcpSelectedAgent.value &&
    Boolean(selectedProjectPath.value) &&
    selectedProjectDirectoryStatus.value === 'checking'
)
const isAcpWorkdirUnavailable = computed(
  () => isAcpWorkdirMissing.value || isAcpWorkdirInvalid.value || isAcpWorkdirChecking.value
)

const syncGuideTargets = () => {
  if (typeof document === 'undefined') {
    return
  }

  agentGuideTargetRef.value =
    (document.querySelector(
      '[data-testid="sidebar-agent-button"][data-agent-id="deepchat"]'
    ) as HTMLElement | null) ??
    (document.querySelector(
      '[data-testid="sidebar-agent-button"][data-agent-type="deepchat"]'
    ) as HTMLElement | null)
  modelGuideTargetRef.value = document.querySelector(
    '[data-testid="app-model-switcher"]'
  ) as HTMLElement | null
  firstChatGuideTargetRef.value =
    (firstChatGuideHostRef.value?.querySelector(
      '[data-testid="chat-input-box"]'
    ) as HTMLElement | null) ?? firstChatGuideHostRef.value
}

const activeChatGuide = computed(() => {
  if (
    switchAgentGuide.showGuide.value &&
    !isDeepChatSelectedAgent.value &&
    agentGuideTargetRef.value
  ) {
    return {
      key: 'switch-agent',
      title: t('chat.onboarding.agentSwitch.title'),
      description: t('chat.onboarding.agentSwitch.description'),
      caption: t('chat.onboarding.agentSwitch.caption'),
      targetEl: agentGuideTargetRef.value,
      stepIndex: switchAgentGuide.stepIndex.value,
      totalSteps: switchAgentGuide.totalSteps.value,
      dismiss: switchAgentGuide.dismissGuide
    }
  }

  if (switchModelGuide.showGuide.value && modelGuideTargetRef.value) {
    return {
      key: 'switch-model',
      preferredPanelPlacement: 'above' as const,
      title: t('welcome.page.guide.steps.switch-model'),
      description: t('chat.onboarding.switchModel.description'),
      caption: t('chat.onboarding.switchModel.caption'),
      targetEl: modelGuideTargetRef.value,
      stepIndex: switchModelGuide.stepIndex.value,
      totalSteps: switchModelGuide.totalSteps.value,
      dismiss: switchModelGuide.dismissGuide
    }
  }

  if (firstChatGuide.showGuide.value && firstChatGuideTargetRef.value) {
    return {
      key: 'first-chat',
      title: t('welcome.complete.title'),
      description: t('welcome.complete.description'),
      caption: t('chat.onboarding.firstChat.caption'),
      targetEl: firstChatGuideTargetRef.value,
      stepIndex: firstChatGuide.stepIndex.value,
      totalSteps: firstChatGuide.totalSteps.value,
      dismiss: firstChatGuide.dismissGuide
    }
  }

  return null
})

const activeChatGuidePrimaryLabel = computed(() => {
  switch (activeChatGuide.value?.key) {
    case 'switch-agent':
    case 'switch-model':
      return t('common.next')
    default:
      return undefined
  }
})

const activeChatGuidePrimaryDisabled = computed(() => {
  switch (activeChatGuide.value?.key) {
    case 'switch-agent':
      return !isDeepChatSelectedAgent.value
    case 'switch-model':
      return !modelGuideTargetRef.value
    default:
      return false
  }
})

const continueChatGuide = async (
  state: Awaited<ReturnType<typeof switchAgentGuide.completeStep>> | null | undefined
) => {
  const stepId = state?.status === 'completed' ? 'first-chat' : state?.currentStepId
  const target = resolveGuidedOnboardingStepTarget(stepId)
  if (target?.surface !== 'settings' || !target.routeName) {
    return
  }

  persistGuidedOnboardingResumeIntent({
    stepId: target.stepId,
    trigger: 'window-focus'
  })
  await configClient.openSettings({ routeName: target.routeName })
}

const completeSwitchAgentStep = async () => {
  if (
    isCompletingSwitchAgentGuide.value ||
    switchAgentGuide.currentStepId.value !== 'switch-agent'
  ) {
    return
  }

  const stepStatus = switchAgentGuide.stepState.value?.status
  if (stepStatus === 'completed' || stepStatus === 'skipped') {
    return
  }

  isCompletingSwitchAgentGuide.value = true
  try {
    const state = await switchAgentGuide.completeStep()
    await continueChatGuide(state)
  } finally {
    isCompletingSwitchAgentGuide.value = false
  }
}

const handleActiveChatGuideBack = async () => {
  switch (activeChatGuide.value?.key) {
    case 'switch-agent': {
      const state = await switchAgentGuide.activatePreviousStep()
      await continueChatGuide(state)
      break
    }
    case 'switch-model': {
      const state = await switchModelGuide.activatePreviousStep()
      await continueChatGuide(state)
      break
    }
    case 'first-chat': {
      const state = await firstChatGuide.activatePreviousStep()
      await continueChatGuide(state)
      break
    }
  }
}

const handleActiveChatGuideExpert = async () => {
  switch (activeChatGuide.value?.key) {
    case 'switch-agent': {
      const state = await switchAgentGuide.forceComplete()
      await continueChatGuide(state)
      break
    }
    case 'switch-model': {
      const state = await switchModelGuide.forceComplete()
      await continueChatGuide(state)
      break
    }
    case 'first-chat': {
      const state = await firstChatGuide.forceComplete()
      await continueChatGuide(state)
      break
    }
  }
}

const handleActiveChatGuidePrimary = async () => {
  switch (activeChatGuide.value?.key) {
    case 'switch-agent':
      if (isDeepChatSelectedAgent.value) {
        await completeSwitchAgentStep()
      }
      break
    case 'switch-model': {
      const state = await switchModelGuide.completeStep()
      await continueChatGuide(state)
      break
    }
  }
}

const ensureEnabledModelsReady = async (): Promise<boolean> => {
  if (modelStore.initialized) {
    return true
  }

  try {
    await modelStore.initialize()
    return true
  } catch (error) {
    console.warn('[NewThreadPage] Failed to initialize enabled models:', error)
    return false
  }
}

async function resolveModel(): Promise<SubmissionModelSelection | null> {
  const ready = await ensureEnabledModelsReady()
  if (!ready) {
    return null
  }

  const [preferredModel, defaultModel] = await Promise.all([
    configClient.getSetting('preferredModel') as Promise<ChatModelSelection | undefined>,
    configClient.getSetting('defaultModel') as Promise<ChatModelSelection | undefined>
  ])

  const resolvedModel = resolvePreferredChatModel({
    modelGroups: modelStore.chatSelectableModelGroups,
    selections: [
      draftStore.providerId && draftStore.modelId
        ? { providerId: draftStore.providerId, modelId: draftStore.modelId }
        : null,
      preferredModel,
      defaultModel
    ]
  })
  if (resolvedModel) {
    return { providerId: resolvedModel.providerId, modelId: resolvedModel.model.id }
  }

  return null
}

function resolveVoiceInputSelection(): SubmissionModelSelection | null {
  if (isAcpSelectedAgent.value) {
    return null
  }

  if (draftStore.providerId && draftStore.modelId) {
    return {
      providerId: draftStore.providerId,
      modelId: draftStore.modelId
    }
  }

  return null
}

function resolveAcpSubmissionSelection(): SubmissionModelSelection | null {
  if (!isAcpSelectedAgent.value) {
    return null
  }

  if (acpDraftModelSelection.value) {
    return acpDraftModelSelection.value
  }

  const agentId = selectedAgent.value.id?.trim()
  return agentId ? { providerId: 'acp', modelId: agentId } : null
}

async function resolveSubmissionModelSelection(): Promise<SubmissionModelSelection | null> {
  if (isAcpSelectedAgent.value) {
    return resolveAcpSubmissionSelection()
  }

  return await resolveModel()
}

async function refreshVoiceInputAvailability() {
  const token = ++voiceInputConfigToken

  if (isAcpSelectedAgent.value) {
    isVoiceInputEnabled.value = false
    voiceInput.stop()
    return
  }

  const explicitSelection = resolveVoiceInputSelection()
  const selection = explicitSelection ?? (modelStore.initialized ? await resolveModel() : null)

  if (!selection) {
    isVoiceInputEnabled.value = false
    voiceInput.stop()
    return
  }

  try {
    const modelConfig = await modelClient.getModelConfig(selection.modelId, selection.providerId)
    if (token !== voiceInputConfigToken) {
      return
    }

    isVoiceInputEnabled.value = modelConfig.speechRecognition === true
    if (!isVoiceInputEnabled.value) {
      voiceInput.stop()
    }
  } catch (error) {
    if (token !== voiceInputConfigToken) {
      return
    }

    console.warn('[NewThreadPage] Failed to resolve voice input setting:', error)
    isVoiceInputEnabled.value = false
    voiceInput.stop()
  }
}

watch(
  () => [selectedAgent.value.id, draftStore.providerId, draftStore.modelId, modelStore.initialized],
  () => {
    void refreshVoiceInputAvailability()
  },
  { immediate: true }
)

const removeModelConfigChangedListener = modelClient.onModelConfigChanged(() => {
  void refreshVoiceInputAvailability()
})

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
  const resolvedModel = resolveChatModelByQuery(
    modelStore.chatSelectableModelGroups,
    requestedModelId
  )
  return resolvedModel
    ? { providerId: resolvedModel.providerId, modelId: resolvedModel.model.id }
    : null
}

const applyStartDeeplink = async (payload: StartDeeplinkPayload) => {
  const draftDefaultsTask = currentDraftDefaultsTask
  if (draftDefaultsTask) {
    await draftDefaultsTask
  }

  await nextTick()
  message.value = buildStartMessage(payload)
  draftStore.systemPrompt = payload.systemPrompt

  const modelsReady = await ensureEnabledModelsReady()
  const matchedModel = modelsReady ? resolveStartModelSelection(payload.modelId) : null
  if (matchedModel) {
    draftStore.providerId = matchedModel.providerId
    draftStore.modelId = matchedModel.modelId
  }

  draftStore.clearPendingStartDeeplink()
}

async function onSubmit() {
  if (isAcpWorkdirUnavailable.value) return

  const text = message.value.trim()
  if (!text) return
  if (shouldIgnoreManualCompactionDraft(text)) return
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))

  try {
    await submitText(text, files)
    message.value = ''
    attachedFiles.value = []
  } catch (e) {
    console.error('[NewThreadPage] submit failed:', e)
  }
}

async function onCommandSubmit(command: string) {
  if (isAcpWorkdirUnavailable.value) return
  const text = command.trim()
  if (!text) return
  if (shouldIgnoreManualCompactionDraft(text)) return
  const files = (await prepareFilesForCurrentModel([...attachedFiles.value])).map((f) => toRaw(f))
  try {
    await submitText(text, files)
    attachedFiles.value = []
  } catch (e) {
    console.error('[NewThreadPage] submit failed:', e)
  }
}

function shouldIgnoreManualCompactionDraft(text: string): boolean {
  return !isAcpSelectedAgent.value && isManualCompactionCommand(text)
}

async function submitText(text: string, files: MessageFile[]) {
  if (!text.trim()) return
  if (isAcpWorkdirUnavailable.value) return

  const preparedHeroFlight = prepareChatInputHeroFlight(resolveChatInputBoxElement())

  const agentId = selectedAgent.value.id
  const isAcp = isAcpSelectedAgent.value
  const draftPermissionMode = draftStore.permissionMode
  const draftDisabledAgentTools = [...draftStore.disabledAgentTools]
  const draftSubagentEnabled = draftStore.subagentEnabled
  const draftGenerationSettings = draftStore.toGenerationSettings()

  try {
    const pendingSkillsSnapshot =
      chatInputRef.value?.getPendingSkillsSnapshot?.() ?? pendingSkills.value
    const dedupedPendingSkills = Array.from(new Set(pendingSkillsSnapshot))
    const messagePayload = {
      text,
      files,
      ...(dedupedPendingSkills.length > 0 ? { activeSkills: dedupedPendingSkills } : {})
    }

    if (isAcp && acpDraftSessionId.value) {
      await sessionStore.selectSession(acpDraftSessionId.value)
      await sessionStore.sendMessage(acpDraftSessionId.value, messagePayload)
      chatInputRef.value?.clearPendingSkills?.()
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
        if (preparedHeroFlight) {
          cancelChatInputHeroFlight()
        }
        return
      }
      providerId = resolved.providerId
      modelId = resolved.modelId
    }

    await sessionStore.createSession({
      message: messagePayload.text,
      files: messagePayload.files,
      projectDir: selectedSessionProjectDir.value,
      agentId,
      providerId,
      modelId,
      permissionMode: draftPermissionMode,
      disabledAgentTools: isAcp ? undefined : draftDisabledAgentTools,
      subagentEnabled: isAcp ? false : draftSubagentEnabled,
      generationSettings: draftGenerationSettings,
      activeSkills: messagePayload.activeSkills
    })
    chatInputRef.value?.clearPendingSkills?.()
  } catch (error) {
    if (preparedHeroFlight) {
      cancelChatInputHeroFlight()
    }
    throw error
  }
}

const buildDraftGenerationSettings = (
  config: DeepChatAgentConfig
): Partial<SessionGenerationSettings> => {
  return {
    systemPrompt: config.systemPrompt ?? ''
  }
}

const resolveDeepChatAgentConfig = async (agentId: string): Promise<DeepChatAgentConfig> => {
  const config = await configClient.resolveDeepChatAgentConfig(agentId)
  if (config) {
    return config
  }

  const systemPrompt = await configClient.getSetting('default_system_prompt')

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
  draftStore.topP = undefined
  draftStore.contextLength = undefined
  draftStore.maxTokens = undefined
  draftStore.timeout = undefined
  draftStore.thinkingBudget = undefined
  draftStore.reasoningEffort = undefined
  draftStore.reasoningVisibility = undefined
  draftStore.verbosity = undefined
  draftStore.forceInterleavedThinkingCompat = undefined
  draftStore.imageGeneration = undefined
  draftStore.videoGeneration = undefined

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

function onToggleVoiceInput() {
  if (!isVoiceInputEnabled.value) {
    return
  }

  void voiceInput.toggle()
}

function notifyUnsupportedAudioAttachments(
  selection: { providerId: string; modelId: string },
  rejectedAudioFiles: MessageFile[]
) {
  if (rejectedAudioFiles.length === 0) {
    return
  }

  const modelLabel =
    modelStore.findChatSelectableModel(selection.providerId, selection.modelId)?.model.name ??
    selection.modelId

  toast({
    title: t('chat.input.audioInputUnsupportedTitle'),
    description: t('chat.input.audioInputUnsupportedDescription', {
      count: rejectedAudioFiles.length,
      model: modelLabel
    })
  })
}

async function prepareFilesForCurrentModel(files: MessageFile[]): Promise<MessageFile[]> {
  const selection = await resolveSubmissionModelSelection()
  if (!selection || files.length === 0) {
    return files
  }

  try {
    const capabilities = await modelClient.getCapabilities(selection.providerId, selection.modelId)
    if (capabilities.supportsAudioInput !== false) {
      return files
    }

    const { acceptedFiles, rejectedAudioFiles } = filterUnsupportedAudioAttachments(files, false)
    notifyUnsupportedAudioAttachments(selection, rejectedAudioFiles)
    return acceptedFiles
  } catch (error) {
    console.warn('[NewThreadPage] Failed to resolve audio input capability:', error)
    return files
  }
}

async function onFilesChange(files: MessageFile[]) {
  const token = ++attachmentFilterToken
  const filteredFiles = await prepareFilesForCurrentModel(files)
  if (token !== attachmentFilterToken) {
    return
  }

  attachedFiles.value = filteredFiles
}

function onPendingSkillsChange(skills: string[]) {
  pendingSkills.value = [...skills]
}

function clearSelectedProject() {
  projectStore.selectProject(null, 'manual')
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
    acpDraftModelSelection.value = null
    lastAcpDraftKey.value = null
  }

  const requestSeq = ++acpDraftRequestSeq.value

  try {
    const session = await sessionClient.ensureAcpDraftSession({
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
      acpDraftModelSelection.value = null
      lastAcpDraftKey.value = null
      return
    }
    acpDraftSessionId.value = sessionId
    acpDraftModelSelection.value =
      typeof session.providerId === 'string' &&
      session.providerId.trim() &&
      typeof session.modelId === 'string' &&
      session.modelId.trim()
        ? { providerId: session.providerId.trim(), modelId: session.modelId.trim() }
        : { providerId: 'acp', modelId: agentId }
    lastAcpDraftKey.value = draftKey
  } catch (error) {
    if (requestSeq !== acpDraftRequestSeq.value) {
      return
    }
    console.warn('[NewThreadPage] Failed to ensure ACP draft session:', error)
    acpDraftSessionId.value = null
    acpDraftModelSelection.value = null
    lastAcpDraftKey.value = null
  }
}

watch(
  () => selectedProjectPath.value,
  async (projectPath) => {
    const requestSeq = ++selectedProjectDirectoryCheckSeq.value
    if (!projectPath) {
      selectedProjectDirectoryStatus.value = 'none'
      return
    }

    selectedProjectDirectoryStatus.value = 'checking'
    try {
      const isDirectory = await fileClient.isDirectory(projectPath)
      if (requestSeq !== selectedProjectDirectoryCheckSeq.value) {
        return
      }
      selectedProjectDirectoryStatus.value = isDirectory ? 'valid' : 'invalid'
    } catch (error) {
      if (requestSeq !== selectedProjectDirectoryCheckSeq.value) {
        return
      }
      console.warn('[NewThreadPage] Failed to validate selected project directory:', error)
      selectedProjectDirectoryStatus.value = 'invalid'
    }
  },
  { immediate: true }
)

watch(
  () =>
    [
      agentStore.selectedAgentId,
      selectedProjectPath.value,
      selectedProjectDirectoryStatus.value
    ] as const,
  ([selectedAgentId, projectPath, directoryStatus]) => {
    acpDraftRequestSeq.value += 1
    cancelEnsureDraftTask?.()
    cancelEnsureDraftTask = null
    if (
      !selectedAgentId ||
      selectedAgent.value.type === 'deepchat' ||
      !projectPath ||
      directoryStatus !== 'valid'
    ) {
      acpDraftSessionId.value = null
      acpDraftModelSelection.value = null
      lastAcpDraftKey.value = null
      return
    }
    cancelEnsureDraftTask = scheduleStartupDeferredTask(async () => {
      await ensureAcpDraftSession(selectedAgentId, projectPath)
    })
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
  void nextTick(syncGuideTargets)
  window.addEventListener('resize', syncGuideTargets)
})

onUnmounted(() => {
  removeModelConfigChangedListener()
  voiceInput.cleanup()
  cancelEnsureDraftTask?.()
  cancelEnsureDraftTask = null
  window.removeEventListener('resize', syncGuideTargets)
})

watch(
  [
    () => switchAgentGuide.showGuide.value,
    () => switchModelGuide.showGuide.value,
    () => firstChatGuide.showGuide.value,
    () => selectedAgent.value.type
  ],
  () => {
    void nextTick(syncGuideTargets)
  },
  { flush: 'post', immediate: true }
)

watch(
  () => [switchAgentGuide.currentStepId.value, isDeepChatSelectedAgent.value] as const,
  ([currentStepId, isDeepChatSelected]) => {
    if (currentStepId === 'switch-agent' && isDeepChatSelected) {
      void completeSwitchAgentStep()
    }
  },
  { immediate: true }
)
</script>
