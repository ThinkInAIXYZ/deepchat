<template>
  <div class="w-full max-w-2xl flex items-center justify-between px-1 py-2">
    <div class="flex items-center gap-1">
      <!-- Model selector -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          >
            <ModelIcon
              :model-id="displayProviderId"
              custom-class="w-3.5 h-3.5"
              :is-dark="themeStore.isDark"
            />
            <span>{{ displayModelName }}</span>
            <Icon icon="lucide:chevron-down" class="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-0 max-h-64 overflow-y-auto">
          <template v-for="group in flatModels" :key="group.providerId + '/' + group.model.id">
            <DropdownMenuItem
              class="gap-2 text-xs py-1.5 px-2"
              @click="selectModel(group.providerId, group.model.id)"
            >
              <ModelIcon
                :model-id="group.providerId"
                custom-class="w-3.5 h-3.5"
                :is-dark="themeStore.isDark"
              />
              <span>{{ group.model.name }}</span>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Effort selector (hide for ACP agents — they don't have effort settings) -->
      <DropdownMenu v-if="!isAcpAgent">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          >
            <Icon icon="lucide:gauge" class="w-3.5 h-3.5" />
            <span>{{ currentEffortLabel }}</span>
            <Icon icon="lucide:chevron-down" class="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-0">
          <DropdownMenuItem
            v-for="option in effortOptions"
            :key="option.value"
            class="text-xs py-1.5 px-2"
            @click="selectEffort(option.value)"
          >
            {{ option.label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Permissions (read-only indicator) -->
    <Button
      variant="ghost"
      size="sm"
      class="h-6 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
    >
      <Icon icon="lucide:shield" class="w-3.5 h-3.5" />
      <span>Default permissions</span>
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Icon } from '@iconify/vue'
import ModelIcon from '../icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/modelStore'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { useDraftStore } from '@/stores/ui/draft'
import { usePresenter } from '@/composables/usePresenter'
import type { RENDERER_MODEL_META } from '@shared/presenter'

type ModelSelection = {
  providerId: string
  modelId: string
}

const themeStore = useThemeStore()
const chatStore = useChatStore()
const modelStore = useModelStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const configPresenter = usePresenter('configPresenter')

const draftModelSelection = ref<ModelSelection | null>(null)
let draftModelSyncToken = 0

// Determine if we're in an active session or on NewThreadPage
const hasActiveSession = computed(() => sessionStore.hasActiveSession)

// Determine the effective agent context
const isAcpAgent = computed(() => {
  if (hasActiveSession.value) {
    // In active session: check active session provider
    return sessionStore.activeSession?.providerId === 'acp'
  }
  // On NewThreadPage: check sidebar agent selection
  const agentId = agentStore.selectedAgentId
  return agentId !== null && agentId !== 'deepchat'
})

const activeSessionSelection = computed<ModelSelection | null>(() => {
  const active = sessionStore.activeSession
  if (!active?.providerId || !active?.modelId) return null
  return {
    providerId: active.providerId,
    modelId: active.modelId
  }
})

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { providerId?: unknown; modelId?: unknown }
  return typeof candidate.providerId === 'string' && typeof candidate.modelId === 'string'
}

const findEnabledModel = (providerId: string, modelId: string): ModelSelection | null => {
  for (const group of modelStore.enabledModels) {
    if (group.providerId !== providerId) continue
    const hit = group.models.find((model) => model.id === modelId)
    if (hit) {
      return { providerId: group.providerId, modelId: hit.id }
    }
  }
  return null
}

const pickFirstEnabledModel = (): ModelSelection | null => {
  for (const group of modelStore.enabledModels) {
    if (group.providerId === 'acp') continue
    const firstModel = group.models[0]
    if (firstModel) {
      return { providerId: group.providerId, modelId: firstModel.id }
    }
  }
  for (const group of modelStore.enabledModels) {
    const firstModel = group.models[0]
    if (firstModel) {
      return { providerId: group.providerId, modelId: firstModel.id }
    }
  }
  return null
}

const resolveModelName = (modelId: string): string => {
  const found = modelStore.findModelByIdOrName(modelId)
  if (found) return found.model.name
  return modelId
}

const syncDraftModelSelection = async () => {
  const token = ++draftModelSyncToken
  if (hasActiveSession.value) return

  if (isAcpAgent.value) {
    const agentId = agentStore.selectedAgentId
    draftModelSelection.value =
      agentId && agentId !== 'deepchat' ? { providerId: 'acp', modelId: agentId } : null
    return
  }

  try {
    const defaultModel = (await configPresenter.getSetting('defaultModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(defaultModel)) {
      const resolvedDefault = findEnabledModel(defaultModel.providerId, defaultModel.modelId)
      if (resolvedDefault) {
        draftModelSelection.value = resolvedDefault
        return
      }
    }

    const preferredModel = (await configPresenter.getSetting('preferredModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(preferredModel)) {
      const resolvedPreferred = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
      if (resolvedPreferred) {
        draftModelSelection.value = resolvedPreferred
        return
      }
    }
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to resolve draft model:', error)
  }

  if (token !== draftModelSyncToken) return
  draftModelSelection.value = pickFirstEnabledModel()
}

watch(
  [hasActiveSession, isAcpAgent, () => agentStore.selectedAgentId, () => modelStore.enabledModels],
  () => {
    if (hasActiveSession.value) return
    void syncDraftModelSelection()
  },
  { immediate: true, deep: true }
)

// Resolve display provider ID
const displayProviderId = computed(() => {
  if (hasActiveSession.value) {
    return (
      activeSessionSelection.value?.providerId || chatStore.chatConfig.providerId || 'anthropic'
    )
  }
  // On NewThreadPage: use agent context
  if (isAcpAgent.value) {
    return agentStore.selectedAgentId ?? 'acp'
  }
  // On NewThreadPage with DeepChat: show resolved draft/default provider
  return draftModelSelection.value?.providerId || 'anthropic'
})

// Resolve display model name
const displayModelName = computed(() => {
  if (hasActiveSession.value) {
    const modelId = activeSessionSelection.value?.modelId || chatStore.chatConfig.modelId
    if (modelId) {
      return resolveModelName(modelId)
    }
    return 'Select model'
  }
  // On NewThreadPage with ACP agent
  if (isAcpAgent.value) {
    const agent = agentStore.selectedAgent
    return agent?.name ?? agentStore.selectedAgentId ?? 'ACP Agent'
  }
  // On NewThreadPage with DeepChat: show resolved draft/default model
  const modelId = draftModelSelection.value?.modelId
  if (modelId) {
    return resolveModelName(modelId)
  }
  return 'Select model'
})

const flatModels = computed(() => {
  const result: { providerId: string; model: RENDERER_MODEL_META }[] = []
  for (const group of modelStore.enabledModels) {
    for (const model of group.models) {
      result.push({ providerId: group.providerId, model })
    }
  }
  return result
})

async function selectModel(providerId: string, modelId: string) {
  if (!hasActiveSession.value) {
    draftModelSelection.value = { providerId, modelId }
    draftStore.providerId = providerId
    draftStore.modelId = modelId
    await configPresenter.setSetting('preferredModel', { providerId, modelId })
  }
  await chatStore.updateChatConfig({ providerId, modelId })
}

// Effort
const effortOptions = [
  { label: 'Low', value: 'low' as const },
  { label: 'Medium', value: 'medium' as const },
  { label: 'High', value: 'high' as const }
]

const currentEffortLabel = computed(() => {
  const config = chatStore.chatConfig
  const effort = config.reasoningEffort ?? config.verbosity ?? 'high'
  const option = effortOptions.find((o) => o.value === effort)
  return option?.label ?? effort.charAt(0).toUpperCase() + effort.slice(1)
})

async function selectEffort(value: 'low' | 'medium' | 'high') {
  await chatStore.updateChatConfig({ reasoningEffort: value })
}
</script>
