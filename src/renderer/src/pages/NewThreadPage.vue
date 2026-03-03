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
          v-model="message"
          :session-id="acpDraftSessionId"
          :workspace-path="projectStore.selectedProject?.path ?? null"
          :is-acp-session="(agentStore.selectedAgentId ?? 'deepchat') !== 'deepchat'"
          :submit-disabled="isAcpWorkdirMissing"
          @pending-skills-change="onPendingSkillsChange"
          @command-submit="onCommandSubmit"
          @submit="onSubmit"
        >
          <template #toolbar>
            <ChatInputToolbar :send-disabled="isAcpWorkdirMissing" @send="onSubmit" />
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

const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const modelStore = useModelStore()
const draftStore = useDraftStore()
const configPresenter = usePresenter('configPresenter')
const newAgentPresenter = usePresenter('newAgentPresenter')

const message = ref('')
const pendingSkills = ref<string[]>([])
const acpDraftSessionId = ref<string | null>(null)
const lastAcpDraftKey = ref<string | null>(null)
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
  message.value = ''

  await submitText(text)
}

async function onCommandSubmit(command: string) {
  if (isAcpWorkdirMissing.value) return
  const text = command.trim()
  if (!text) return
  await submitText(text)
}

async function submitText(text: string) {
  if (!text.trim()) return

  const agentId = agentStore.selectedAgentId ?? 'deepchat'
  const isAcp = agentId !== 'deepchat'

  if (isAcp && acpDraftSessionId.value) {
    await sessionStore.selectSession(acpDraftSessionId.value)
    await sessionStore.sendMessage(acpDraftSessionId.value, text)
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

  await sessionStore.createSession({
    message: text,
    projectDir: projectStore.selectedProject?.path,
    agentId,
    providerId,
    modelId,
    permissionMode: draftStore.permissionMode,
    activeSkills: pendingSkills.value.length > 0 ? [...pendingSkills.value] : undefined
  })
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

  try {
    const session = await newAgentPresenter.ensureAcpDraftSession({
      agentId,
      projectDir,
      permissionMode: draftStore.permissionMode
    })
    acpDraftSessionId.value = session.id
    lastAcpDraftKey.value = draftKey
  } catch (error) {
    console.warn('[NewThreadPage] Failed to ensure ACP draft session:', error)
    acpDraftSessionId.value = null
    lastAcpDraftKey.value = null
  }
}

watch(
  () => [agentStore.selectedAgentId, projectStore.selectedProject?.path] as const,
  ([selectedAgentId, projectPath]) => {
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
})
</script>
