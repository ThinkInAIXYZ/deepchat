<template>
  <div :class="['relative w-full', props.maxWidthClass]">
    <div class="w-full flex items-center justify-between px-1 py-2">
      <div class="flex items-center gap-1">
        <DropdownMenu v-if="!isModelSelectionLocked">
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
        <Button
          v-else
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          :disabled="true"
        >
          <ModelIcon
            :model-id="displayProviderId"
            custom-class="w-3.5 h-3.5"
            :is-dark="themeStore.isDark"
          />
          <span>{{ displayModelName }}</span>
        </Button>

        <DropdownMenu v-if="showEffortSelector">
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

      <div class="flex items-center gap-1">
        <McpIndicator />

        <Button
          v-if="showAdvancedSettingsButton"
          ref="advancedButtonRef"
          variant="ghost"
          size="sm"
          class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground backdrop-blur-lg"
          :aria-label="t('chat.advancedSettings.button')"
          :title="t('chat.advancedSettings.button')"
          @click="toggleAdvancedSettings"
        >
          <Icon icon="lucide:sliders-horizontal" class="w-3.5 h-3.5" />
        </Button>

        <DropdownMenu v-if="canSelectPermissionMode">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
            >
              <Icon icon="lucide:shield" class="w-3.5 h-3.5" />
              <span>{{ permissionModeLabel }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-0">
            <DropdownMenuItem
              class="text-xs py-1.5 px-2"
              :disabled="permissionMode === 'full_access'"
              @click="selectPermissionMode('full_access')"
            >
              Full access
            </DropdownMenuItem>
            <DropdownMenuItem
              class="text-xs py-1.5 px-2"
              :disabled="permissionMode === 'default'"
              @click="selectPermissionMode('default')"
            >
              Default permissions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          v-else
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          :disabled="true"
        >
          <Icon icon="lucide:shield" class="w-3.5 h-3.5" />
          <span>Full access</span>
        </Button>
      </div>
    </div>

    <div
      v-if="isAdvancedOpen && showAdvancedSettingsButton && localSettings"
      ref="advancedOverlayRef"
      class="absolute bottom-full left-1/2 z-30 mb-2 w-full -translate-x-1/2 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur-lg"
    >
      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <div class="flex items-center gap-2">
          <Icon icon="lucide:sliders-horizontal" class="h-4 w-4" />
          <span>{{ t('chat.advancedSettings.title') }}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="closeAdvancedSettings"
        >
          <Icon icon="lucide:x" class="h-3.5 w-3.5" />
        </Button>
      </div>

      <div class="mt-4 space-y-4">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium">{{ t('chat.advancedSettings.systemPrompt') }}</label>
            <span
              v-if="selectedSystemPromptId === '__custom__'"
              class="text-[11px] text-muted-foreground"
            >
              {{ t('chat.advancedSettings.currentCustomPrompt') }}
            </span>
          </div>
          <Select
            :model-value="selectedSystemPromptId"
            @update:model-value="onSystemPromptSelect($event as string)"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue :placeholder="t('chat.advancedSettings.systemPromptPlaceholder')" />
            </SelectTrigger>
            <SelectContent class="advanced-settings-portal-content">
              <SelectItem
                v-for="option in systemPromptOptions"
                :key="option.id"
                :value="option.id"
                :disabled="option.disabled"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">{{ t('chat.advancedSettings.temperature') }}</label>
            <Input
              class="h-7 w-20 text-xs tabular-nums"
              type="number"
              :min="TEMPERATURE_MIN"
              :max="TEMPERATURE_MAX"
              step="0.1"
              :model-value="localSettings.temperature.toFixed(1)"
              @update:model-value="onTemperatureInput"
            />
          </div>
          <Slider
            :model-value="[localSettings.temperature]"
            :min="TEMPERATURE_MIN"
            :max="TEMPERATURE_MAX"
            :step="0.1"
            @update:model-value="onTemperatureSlider"
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">{{
              t('chat.advancedSettings.contextLength')
            }}</label>
            <Input
              class="h-7 w-24 text-xs tabular-nums"
              type="number"
              :min="CONTEXT_LENGTH_MIN"
              :max="contextLengthLimit"
              :step="1024"
              :model-value="localSettings.contextLength.toString()"
              @update:model-value="onContextLengthInput"
            />
          </div>
          <Slider
            :model-value="[localSettings.contextLength]"
            :min="CONTEXT_LENGTH_MIN"
            :max="contextLengthLimit"
            :step="1024"
            @update:model-value="onContextLengthSlider"
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label class="text-xs font-medium">{{ t('chat.advancedSettings.maxTokens') }}</label>
            <Input
              class="h-7 w-24 text-xs tabular-nums"
              type="number"
              :min="MAX_TOKENS_MIN"
              :max="maxTokensSliderLimit"
              :step="128"
              :model-value="localSettings.maxTokens.toString()"
              @update:model-value="onMaxTokensInput"
            />
          </div>
          <Slider
            :model-value="[localSettings.maxTokens]"
            :min="MAX_TOKENS_MIN"
            :max="maxTokensSliderLimit"
            :step="128"
            @update:model-value="onMaxTokensSlider"
          />
        </div>

        <div v-if="showThinkingBudget" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium">{{
              t('chat.advancedSettings.thinkingBudget')
            }}</label>
            <span class="text-[11px] text-muted-foreground">{{ thinkingBudgetHint }}</span>
          </div>
          <Input
            class="h-8 text-xs"
            type="number"
            :min="budgetRange?.min"
            :max="budgetRange?.max"
            :step="128"
            :model-value="localSettings.thinkingBudget?.toString() ?? ''"
            @update:model-value="onThinkingBudgetInput"
          />
        </div>

        <div v-if="showVerbosity" class="space-y-1.5">
          <label class="text-xs font-medium">{{ t('chat.advancedSettings.verbosity') }}</label>
          <Select
            :model-value="localSettings.verbosity ?? 'medium'"
            @update:model-value="onVerbositySelect($event as string)"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue :placeholder="t('chat.advancedSettings.verbosityPlaceholder')" />
            </SelectTrigger>
            <SelectContent class="advanced-settings-portal-content">
              <SelectItem value="low">{{
                t('settings.model.modelConfig.verbosity.options.low')
              }}</SelectItem>
              <SelectItem value="medium">{{
                t('settings.model.modelConfig.verbosity.options.medium')
              }}</SelectItem>
              <SelectItem value="high">{{
                t('settings.model.modelConfig.verbosity.options.high')
              }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Slider } from '@shadcn/components/ui/slider'
import { Input } from '@shadcn/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Icon } from '@iconify/vue'
import ModelIcon from '../icons/ModelIcon.vue'
import McpIndicator from '@/components/chat-input/McpIndicator.vue'
import { useThemeStore } from '@/stores/theme'
import { useModelStore } from '@/stores/modelStore'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { useDraftStore } from '@/stores/ui/draft'
import { usePresenter } from '@/composables/usePresenter'
import type { RENDERER_MODEL_META, SystemPrompt } from '@shared/presenter'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'

const props = withDefaults(
  defineProps<{
    maxWidthClass?: string
  }>(),
  {
    maxWidthClass: 'max-w-2xl'
  }
)

type ModelSelection = {
  providerId: string
  modelId: string
}

type SystemPromptOption = {
  id: string
  label: string
  content: string
  disabled?: boolean
}

const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 2
const CONTEXT_LENGTH_MIN = 2048
const MAX_TOKENS_MIN = 128

const themeStore = useThemeStore()
const modelStore = useModelStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const configPresenter = usePresenter('configPresenter')
const newAgentPresenter = usePresenter('newAgentPresenter')
const { t } = useI18n()

const draftModelSelection = ref<ModelSelection | null>(null)
let draftModelSyncToken = 0
const permissionMode = ref<PermissionMode>('full_access')
let permissionSyncToken = 0

const isAdvancedOpen = ref(false)
const advancedOverlayRef = ref<HTMLElement | null>(null)
const advancedButtonRef = ref<HTMLElement | { $el?: unknown } | null>(null)
const localSettings = ref<SessionGenerationSettings | null>(null)
const systemPromptList = ref<SystemPrompt[]>([])

const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityBudgetRange = ref<{ min?: number; max?: number; default?: number } | null>(null)
const capabilitySupportsEffort = ref<boolean | null>(null)
const capabilitySupportsVerbosity = ref<boolean | null>(null)

let generationSyncToken = 0
let generationPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingGenerationPatch: Partial<SessionGenerationSettings> = {}
let generationPersistRequestToken = 0

const hasActiveSession = computed(() => sessionStore.hasActiveSession)

const isAcpAgent = computed(() => {
  if (hasActiveSession.value) {
    return sessionStore.activeSession?.providerId === 'acp'
  }
  const agentId = agentStore.selectedAgentId
  return agentId !== null && agentId !== 'deepchat'
})

const lockedAcpModelId = computed(() => {
  if (hasActiveSession.value && sessionStore.activeSession?.providerId === 'acp') {
    return sessionStore.activeSession.modelId || null
  }
  const selectedAgentId = agentStore.selectedAgentId
  return selectedAgentId && selectedAgentId !== 'deepchat' ? selectedAgentId : null
})

const isModelSelectionLocked = computed(() => isAcpAgent.value && Boolean(lockedAcpModelId.value))

const activeSessionSelection = computed<ModelSelection | null>(() => {
  const active = sessionStore.activeSession
  if (!active?.providerId || !active?.modelId) return null
  return {
    providerId: active.providerId,
    modelId: active.modelId
  }
})

const effectiveModelSelection = computed<ModelSelection | null>(() => {
  if (hasActiveSession.value) {
    return activeSessionSelection.value
  }
  if (isAcpAgent.value) {
    const agentId = agentStore.selectedAgentId
    return agentId && agentId !== 'deepchat' ? { providerId: 'acp', modelId: agentId } : null
  }
  return draftModelSelection.value
})

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { providerId?: unknown; modelId?: unknown }
  return typeof candidate.providerId === 'string' && typeof candidate.modelId === 'string'
}

const isReasoningEffort = (value: unknown): value is SessionGenerationSettings['reasoningEffort'] =>
  value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'

const isVerbosity = (value: unknown): value is SessionGenerationSettings['verbosity'] =>
  value === 'low' || value === 'medium' || value === 'high'

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min
  if (value > max) return max
  return value
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return undefined
  }
  return value
}

const resolveDomElement = (value: HTMLElement | { $el?: unknown } | null): HTMLElement | null => {
  if (!value) {
    return null
  }
  if (value instanceof HTMLElement) {
    return value
  }
  return value.$el instanceof HTMLElement ? value.$el : null
}

const parseNumericInput = (value: string | number): number | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : String(value)
  if (!normalized) {
    return undefined
  }
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) {
    return undefined
  }
  return numeric
}

const normalizeReasoningEffort = (
  providerId: string,
  value: unknown
): SessionGenerationSettings['reasoningEffort'] | undefined => {
  if (!isReasoningEffort(value)) {
    return undefined
  }
  if (providerId !== 'grok') {
    return value
  }
  if (value === 'low' || value === 'high') {
    return value
  }
  return value === 'minimal' ? 'low' : 'high'
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

const getCurrentLimits = () => {
  const selection = effectiveModelSelection.value
  if (!selection) {
    return {
      contextLengthLimit: 32000,
      maxTokensLimit: 8192
    }
  }

  const modelConfig = configPresenter.getModelConfig(selection.modelId, selection.providerId)
  const contextLengthLimit = Math.max(
    CONTEXT_LENGTH_MIN,
    Math.round(toFiniteNumber(modelConfig.contextLength) ?? 32000)
  )
  const maxTokensLimit = Math.max(
    MAX_TOKENS_MIN,
    Math.round(toFiniteNumber(modelConfig.maxTokens) ?? 4096)
  )
  return { contextLengthLimit, maxTokensLimit }
}

const contextLengthLimit = computed(() => getCurrentLimits().contextLengthLimit)

const maxTokensSliderLimit = computed(() => {
  const baseLimit = getCurrentLimits().maxTokensLimit
  const contextLimit = localSettings.value?.contextLength ?? contextLengthLimit.value
  return Math.max(MAX_TOKENS_MIN, Math.min(baseLimit, contextLimit))
})

const syncDraftModelSelection = async () => {
  const token = ++draftModelSyncToken
  if (hasActiveSession.value) return

  const applyDraftSelection = (selection: ModelSelection | null) => {
    draftModelSelection.value = selection
    draftStore.providerId = selection?.providerId
    draftStore.modelId = selection?.modelId
  }

  if (isAcpAgent.value) {
    const agentId = agentStore.selectedAgentId
    applyDraftSelection(
      agentId && agentId !== 'deepchat' ? { providerId: 'acp', modelId: agentId } : null
    )
    return
  }

  try {
    const defaultModel = (await configPresenter.getSetting('defaultModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(defaultModel)) {
      const resolvedDefault = findEnabledModel(defaultModel.providerId, defaultModel.modelId)
      if (resolvedDefault) {
        applyDraftSelection(resolvedDefault)
        return
      }
    }

    const preferredModel = (await configPresenter.getSetting('preferredModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(preferredModel)) {
      const resolvedPreferred = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
      if (resolvedPreferred) {
        applyDraftSelection(resolvedPreferred)
        return
      }
    }
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to resolve draft model:', error)
  }

  if (token !== draftModelSyncToken) return
  applyDraftSelection(pickFirstEnabledModel())
}

watch(
  [hasActiveSession, isAcpAgent, () => agentStore.selectedAgentId, () => modelStore.enabledModels],
  () => {
    if (hasActiveSession.value) return
    void syncDraftModelSelection()
  },
  { immediate: true, deep: true }
)

const canSelectPermissionMode = computed(() => !isAcpAgent.value)

watch(
  [() => sessionStore.activeSessionId, canSelectPermissionMode, () => draftStore.permissionMode],
  async ([sessionId, canSelect, draftPermissionMode]) => {
    const token = ++permissionSyncToken
    if (!canSelect) {
      permissionMode.value = 'full_access'
      return
    }

    if (!sessionId) {
      permissionMode.value = draftPermissionMode === 'default' ? 'default' : 'full_access'
      return
    }

    try {
      const mode = await newAgentPresenter.getPermissionMode(sessionId)
      if (token !== permissionSyncToken) return
      permissionMode.value = mode === 'default' ? 'default' : 'full_access'
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load permission mode:', error)
      if (token !== permissionSyncToken) return
      permissionMode.value = 'full_access'
    }
  },
  { immediate: true }
)

const displayProviderId = computed(() => {
  if (hasActiveSession.value) {
    return (
      activeSessionSelection.value?.providerId ||
      draftModelSelection.value?.providerId ||
      'anthropic'
    )
  }
  if (isAcpAgent.value) {
    return agentStore.selectedAgentId ?? 'acp'
  }
  return draftModelSelection.value?.providerId || 'anthropic'
})

const displayModelName = computed(() => {
  if (hasActiveSession.value) {
    const modelId = activeSessionSelection.value?.modelId || draftModelSelection.value?.modelId
    if (modelId) {
      return resolveModelName(modelId)
    }
    return 'Select model'
  }
  if (isAcpAgent.value) {
    const agent = agentStore.selectedAgent
    return agent?.name ?? agentStore.selectedAgentId ?? 'ACP Agent'
  }
  const modelId = draftModelSelection.value?.modelId
  if (modelId) {
    return resolveModelName(modelId)
  }
  return 'Select model'
})

const flatModels = computed(() => {
  if (isAcpAgent.value) {
    const targetModelId = lockedAcpModelId.value
    const acpGroup = modelStore.enabledModels.find((group) => group.providerId === 'acp')
    if (!targetModelId || !acpGroup) return []
    return acpGroup.models
      .filter((model) => model.id === targetModelId)
      .map((model) => ({ providerId: 'acp', model }))
  }

  const result: { providerId: string; model: RENDERER_MODEL_META }[] = []
  for (const group of modelStore.enabledModels) {
    if (group.providerId === 'acp') {
      continue
    }
    for (const model of group.models) {
      result.push({ providerId: group.providerId, model })
    }
  }
  return result
})

const resolveDefaultGenerationSettings = async (
  providerId: string,
  modelId: string
): Promise<SessionGenerationSettings> => {
  const modelConfig = configPresenter.getModelConfig(modelId, providerId)
  const defaultSystemPrompt = await configPresenter.getDefaultSystemPrompt()
  const limits = getCurrentLimits()

  const defaults: SessionGenerationSettings = {
    systemPrompt: defaultSystemPrompt ?? '',
    temperature: clamp(
      toFiniteNumber(modelConfig.temperature) ?? 0.7,
      TEMPERATURE_MIN,
      TEMPERATURE_MAX
    ),
    contextLength: clamp(
      Math.round(toFiniteNumber(modelConfig.contextLength) ?? limits.contextLengthLimit),
      CONTEXT_LENGTH_MIN,
      limits.contextLengthLimit
    ),
    maxTokens: clamp(
      Math.round(toFiniteNumber(modelConfig.maxTokens) ?? Math.min(4096, limits.maxTokensLimit)),
      MAX_TOKENS_MIN,
      limits.maxTokensLimit
    )
  }
  defaults.maxTokens = Math.min(defaults.maxTokens, defaults.contextLength)

  const supportsReasoning =
    configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
  if (supportsReasoning) {
    const range = configPresenter.getThinkingBudgetRange?.(providerId, modelId) ?? {}
    const defaultBudget = toFiniteNumber(modelConfig.thinkingBudget ?? range.default)
    if (defaultBudget !== undefined) {
      let budget = Math.round(defaultBudget)
      if (typeof range.min === 'number') {
        budget = Math.max(budget, Math.round(range.min))
      }
      if (typeof range.max === 'number') {
        budget = Math.min(budget, Math.round(range.max))
      }
      defaults.thinkingBudget = budget
    }
  }

  const supportsEffort =
    configPresenter.supportsReasoningEffortCapability?.(providerId, modelId) === true
  if (supportsEffort) {
    const effort = normalizeReasoningEffort(
      providerId,
      modelConfig.reasoningEffort ??
        configPresenter.getReasoningEffortDefault?.(providerId, modelId)
    )
    if (effort) {
      defaults.reasoningEffort = effort
    }
  }

  const supportsVerbosity =
    configPresenter.supportsVerbosityCapability?.(providerId, modelId) === true
  if (supportsVerbosity) {
    const verbosity =
      modelConfig.verbosity ?? configPresenter.getVerbosityDefault?.(providerId, modelId)
    if (isVerbosity(verbosity)) {
      defaults.verbosity = verbosity
    }
  }

  return defaults
}

const mergeDraftOverrides = (
  providerId: string,
  defaults: SessionGenerationSettings
): SessionGenerationSettings => {
  const next: SessionGenerationSettings = {
    ...defaults,
    ...(draftStore.systemPrompt !== undefined ? { systemPrompt: draftStore.systemPrompt } : {}),
    ...(draftStore.temperature !== undefined ? { temperature: draftStore.temperature } : {}),
    ...(draftStore.contextLength !== undefined ? { contextLength: draftStore.contextLength } : {}),
    ...(draftStore.maxTokens !== undefined ? { maxTokens: draftStore.maxTokens } : {}),
    ...(draftStore.thinkingBudget !== undefined
      ? { thinkingBudget: draftStore.thinkingBudget }
      : {}),
    ...(draftStore.reasoningEffort !== undefined
      ? { reasoningEffort: normalizeReasoningEffort(providerId, draftStore.reasoningEffort) }
      : {}),
    ...(draftStore.verbosity !== undefined ? { verbosity: draftStore.verbosity } : {})
  }

  const limits = getCurrentLimits()
  next.temperature = clamp(next.temperature, TEMPERATURE_MIN, TEMPERATURE_MAX)
  next.contextLength = clamp(
    Math.round(next.contextLength),
    CONTEXT_LENGTH_MIN,
    limits.contextLengthLimit
  )
  next.maxTokens = clamp(
    Math.round(next.maxTokens),
    MAX_TOKENS_MIN,
    Math.min(limits.maxTokensLimit, next.contextLength)
  )

  return next
}

const fetchCapabilities = async (providerId: string, modelId: string): Promise<void> => {
  try {
    const [supportsReasoning, budgetRange, supportsEffort, supportsVerbosity] = await Promise.all([
      configPresenter.supportsReasoningCapability?.(providerId, modelId),
      configPresenter.getThinkingBudgetRange?.(providerId, modelId),
      configPresenter.supportsReasoningEffortCapability?.(providerId, modelId),
      configPresenter.supportsVerbosityCapability?.(providerId, modelId)
    ])

    capabilitySupportsReasoning.value =
      typeof supportsReasoning === 'boolean' ? supportsReasoning : null
    capabilityBudgetRange.value = budgetRange ?? null
    capabilitySupportsEffort.value = typeof supportsEffort === 'boolean' ? supportsEffort : null
    capabilitySupportsVerbosity.value =
      typeof supportsVerbosity === 'boolean' ? supportsVerbosity : null
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to fetch model capabilities:', error)
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilitySupportsVerbosity.value = null
  }
}

const clearPendingGenerationPersist = () => {
  if (generationPersistTimer) {
    clearTimeout(generationPersistTimer)
    generationPersistTimer = null
  }
  pendingGenerationPatch = {}
}

const flushGenerationPatch = async () => {
  const patch = pendingGenerationPatch
  pendingGenerationPatch = {}
  generationPersistTimer = null

  if (Object.keys(patch).length === 0) {
    return
  }

  const sessionId = sessionStore.activeSessionId
  if (!sessionId) {
    draftStore.updateGenerationSettings(patch)
    return
  }

  const requestToken = ++generationPersistRequestToken
  try {
    const updated = await newAgentPresenter.updateSessionGenerationSettings(sessionId, patch)
    if (requestToken !== generationPersistRequestToken) {
      return
    }
    if (!localSettings.value) {
      localSettings.value = { ...updated }
      return
    }
    localSettings.value = {
      ...localSettings.value,
      ...updated
    }
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to update generation settings:', error)
  }
}

const scheduleGenerationPersist = (patch: Partial<SessionGenerationSettings>) => {
  pendingGenerationPatch = { ...pendingGenerationPatch, ...patch }
  if (generationPersistTimer) {
    clearTimeout(generationPersistTimer)
  }
  generationPersistTimer = setTimeout(() => {
    void flushGenerationPatch()
  }, 300)
}

const updateLocalGenerationSettings = (patch: Partial<SessionGenerationSettings>) => {
  if (!localSettings.value) {
    return
  }
  generationSyncToken += 1

  const limits = getCurrentLimits()
  const next: SessionGenerationSettings = {
    ...localSettings.value,
    ...patch
  }

  next.temperature = clamp(next.temperature, TEMPERATURE_MIN, TEMPERATURE_MAX)
  next.contextLength = clamp(
    Math.round(next.contextLength),
    CONTEXT_LENGTH_MIN,
    limits.contextLengthLimit
  )
  next.maxTokens = clamp(
    Math.round(next.maxTokens),
    MAX_TOKENS_MIN,
    Math.min(limits.maxTokensLimit, next.contextLength)
  )

  localSettings.value = next

  const normalizedPatch: Partial<SessionGenerationSettings> = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')) {
    normalizedPatch.systemPrompt = next.systemPrompt
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'temperature')) {
    normalizedPatch.temperature = next.temperature
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'contextLength')) {
    normalizedPatch.contextLength = next.contextLength
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxTokens')) {
    normalizedPatch.maxTokens = next.maxTokens
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'thinkingBudget')) {
    normalizedPatch.thinkingBudget = next.thinkingBudget
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')) {
    normalizedPatch.reasoningEffort = next.reasoningEffort
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'verbosity')) {
    normalizedPatch.verbosity = next.verbosity
  }

  scheduleGenerationPersist(normalizedPatch)
}

const syncGenerationSettings = async () => {
  const token = ++generationSyncToken
  clearPendingGenerationPersist()

  if (isAcpAgent.value) {
    localSettings.value = null
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilitySupportsVerbosity.value = null
    isAdvancedOpen.value = false
    return
  }

  const selection = effectiveModelSelection.value
  if (!selection) {
    localSettings.value = null
    return
  }

  await fetchCapabilities(selection.providerId, selection.modelId)
  if (token !== generationSyncToken) {
    return
  }

  const sessionId = sessionStore.activeSessionId
  if (sessionId) {
    try {
      const settings = await newAgentPresenter.getSessionGenerationSettings(sessionId)
      if (token !== generationSyncToken) {
        return
      }
      if (settings) {
        localSettings.value = { ...settings }
      } else {
        localSettings.value = await resolveDefaultGenerationSettings(
          selection.providerId,
          selection.modelId
        )
      }
      return
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load session generation settings:', error)
    }
  }

  const defaults = await resolveDefaultGenerationSettings(selection.providerId, selection.modelId)
  if (token !== generationSyncToken) {
    return
  }
  localSettings.value = mergeDraftOverrides(selection.providerId, defaults)
}

watch(
  [
    () => sessionStore.activeSessionId,
    () => sessionStore.activeSession?.providerId,
    () => sessionStore.activeSession?.modelId,
    () => draftModelSelection.value?.providerId,
    () => draftModelSelection.value?.modelId,
    () => isAcpAgent.value
  ],
  () => {
    void syncGenerationSettings()
  },
  { immediate: true }
)

const reloadSystemPrompts = async () => {
  try {
    systemPromptList.value = await configPresenter.getSystemPrompts()
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to load system prompt options:', error)
    systemPromptList.value = []
  }
}

const systemPromptOptions = computed<SystemPromptOption[]>(() => {
  const presetOptions: SystemPromptOption[] = [
    {
      id: 'empty',
      label: t('promptSetting.emptySystemPromptOption'),
      content: ''
    },
    ...systemPromptList.value.map((prompt) => ({
      id: prompt.id,
      label: prompt.name,
      content: prompt.content
    }))
  ]

  const currentPrompt = localSettings.value?.systemPrompt ?? ''
  if (!currentPrompt) {
    return presetOptions
  }

  const matched = presetOptions.find((option) => option.content === currentPrompt)
  if (matched) {
    return presetOptions
  }

  return [
    {
      id: '__custom__',
      label: t('chat.advancedSettings.currentCustomPrompt'),
      content: currentPrompt,
      disabled: true
    },
    ...presetOptions
  ]
})

const selectedSystemPromptId = computed(() => {
  if (!localSettings.value) {
    return 'empty'
  }
  const currentPrompt = localSettings.value.systemPrompt
  const matched = systemPromptOptions.value.find((option) => option.content === currentPrompt)
  return matched?.id ?? 'empty'
})

watch(isAdvancedOpen, (open) => {
  if (!open) {
    return
  }
  void reloadSystemPrompts()
})

const showAdvancedSettingsButton = computed(() => !isAcpAgent.value && Boolean(localSettings.value))

const showThinkingBudget = computed(() => {
  if (!localSettings.value) {
    return false
  }
  return (
    capabilitySupportsReasoning.value === true && capabilityBudgetRange.value?.max !== undefined
  )
})

const budgetRange = computed(() => capabilityBudgetRange.value)

const thinkingBudgetHint = computed(() => {
  const value = localSettings.value?.thinkingBudget
  if (value === undefined) {
    return t('chat.advancedSettings.useDefault')
  }
  return String(value)
})

const showVerbosity = computed(
  () =>
    !isAcpAgent.value && capabilitySupportsVerbosity.value === true && Boolean(localSettings.value)
)

const showEffortSelector = computed(
  () => !isAcpAgent.value && capabilitySupportsEffort.value === true && Boolean(localSettings.value)
)

const effortOptions = computed(() => {
  const providerId = effectiveModelSelection.value?.providerId
  if (providerId === 'grok') {
    return [
      {
        value: 'low' as const,
        label: t('settings.model.modelConfig.reasoningEffort.options.low')
      },
      {
        value: 'high' as const,
        label: t('settings.model.modelConfig.reasoningEffort.options.high')
      }
    ]
  }

  return [
    {
      value: 'minimal' as const,
      label: t('settings.model.modelConfig.reasoningEffort.options.minimal')
    },
    {
      value: 'low' as const,
      label: t('settings.model.modelConfig.reasoningEffort.options.low')
    },
    {
      value: 'medium' as const,
      label: t('settings.model.modelConfig.reasoningEffort.options.medium')
    },
    {
      value: 'high' as const,
      label: t('settings.model.modelConfig.reasoningEffort.options.high')
    }
  ]
})

const currentEffortLabel = computed(() => {
  const effort = localSettings.value?.reasoningEffort
  if (!effort) {
    return t('chat.advancedSettings.useDefault')
  }
  const option = effortOptions.value.find((item) => item.value === effort)
  return option?.label ?? effort
})

const permissionModeLabel = computed(() =>
  permissionMode.value === 'default' ? 'Default permissions' : 'Full access'
)

const handleDocumentMouseDown = (event: MouseEvent) => {
  if (!isAdvancedOpen.value) {
    return
  }
  const target = event.target as Node | null
  if (!target) {
    return
  }

  if (target instanceof Element && target.closest('.advanced-settings-portal-content')) {
    return
  }

  if (advancedOverlayRef.value?.contains(target)) {
    return
  }
  const advancedButtonEl = resolveDomElement(advancedButtonRef.value)
  if (advancedButtonEl?.contains(target)) {
    return
  }

  closeAdvancedSettings()
}

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (!isAdvancedOpen.value) {
    return
  }
  if (event.key === 'Escape') {
    closeAdvancedSettings()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
  clearPendingGenerationPersist()
})

function toggleAdvancedSettings() {
  if (!showAdvancedSettingsButton.value) {
    return
  }
  isAdvancedOpen.value = !isAdvancedOpen.value
}

function closeAdvancedSettings() {
  isAdvancedOpen.value = false
}

async function selectModel(providerId: string, modelId: string) {
  if (isModelSelectionLocked.value) {
    return
  }

  if (hasActiveSession.value) {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) {
      return
    }
    try {
      await sessionStore.setSessionModel(sessionId, providerId, modelId)
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to switch active session model:', error)
    }
    return
  }

  if (!hasActiveSession.value) {
    draftModelSelection.value = { providerId, modelId }
    draftStore.providerId = providerId
    draftStore.modelId = modelId
    await configPresenter.setSetting('preferredModel', { providerId, modelId })
  }
}

function selectEffort(value: 'minimal' | 'low' | 'medium' | 'high') {
  if (!localSettings.value) {
    return
  }

  const providerId = effectiveModelSelection.value?.providerId
  const normalized = normalizeReasoningEffort(providerId ?? '', value)
  if (!normalized) {
    return
  }
  updateLocalGenerationSettings({ reasoningEffort: normalized })
}

function onSystemPromptSelect(optionId: string) {
  if (!localSettings.value) {
    return
  }
  const option = systemPromptOptions.value.find((item) => item.id === optionId)
  if (!option || option.disabled) {
    return
  }
  updateLocalGenerationSettings({ systemPrompt: option.content })
}

function onTemperatureSlider(values: number[]) {
  const next = values[0]
  if (!localSettings.value || typeof next !== 'number') {
    return
  }
  updateLocalGenerationSettings({ temperature: Number(next.toFixed(1)) })
}

function onTemperatureInput(value: string | number) {
  if (!localSettings.value) {
    return
  }
  const numeric = parseNumericInput(value)
  if (numeric === undefined) {
    return
  }
  const next = clamp(numeric, TEMPERATURE_MIN, TEMPERATURE_MAX)
  updateLocalGenerationSettings({ temperature: Number(next.toFixed(1)) })
}

function onContextLengthSlider(values: number[]) {
  const next = values[0]
  if (!localSettings.value || typeof next !== 'number') {
    return
  }
  updateLocalGenerationSettings({ contextLength: Math.round(next) })
}

function onContextLengthInput(value: string | number) {
  if (!localSettings.value) {
    return
  }
  const numeric = parseNumericInput(value)
  if (numeric === undefined) {
    return
  }
  const next = clamp(Math.round(numeric), CONTEXT_LENGTH_MIN, contextLengthLimit.value)
  updateLocalGenerationSettings({ contextLength: next })
}

function onMaxTokensSlider(values: number[]) {
  const next = values[0]
  if (!localSettings.value || typeof next !== 'number') {
    return
  }
  updateLocalGenerationSettings({ maxTokens: Math.round(next) })
}

function onMaxTokensInput(value: string | number) {
  if (!localSettings.value) {
    return
  }
  const numeric = parseNumericInput(value)
  if (numeric === undefined) {
    return
  }
  const next = clamp(Math.round(numeric), MAX_TOKENS_MIN, maxTokensSliderLimit.value)
  updateLocalGenerationSettings({ maxTokens: next })
}

function onThinkingBudgetInput(value: string | number) {
  if (!localSettings.value) {
    return
  }
  const normalized = typeof value === 'string' ? value.trim() : String(value)
  if (!normalized) {
    updateLocalGenerationSettings({ thinkingBudget: undefined })
    return
  }

  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) {
    return
  }

  const range = budgetRange.value
  let budget = Math.round(numeric)
  if (typeof range?.min === 'number') {
    budget = Math.max(budget, Math.round(range.min))
  }
  if (typeof range?.max === 'number') {
    budget = Math.min(budget, Math.round(range.max))
  }
  updateLocalGenerationSettings({ thinkingBudget: budget })
}

function onVerbositySelect(value: string) {
  if (!localSettings.value || !isVerbosity(value)) {
    return
  }
  updateLocalGenerationSettings({ verbosity: value })
}

async function selectPermissionMode(mode: PermissionMode) {
  if (!canSelectPermissionMode.value) return
  if (permissionMode.value === mode) return

  permissionMode.value = mode
  const sessionId = sessionStore.activeSessionId
  if (!sessionId) {
    draftStore.permissionMode = mode
    return
  }
  try {
    await newAgentPresenter.setPermissionMode(sessionId, mode)
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to set permission mode:', error)
  }
}
</script>
