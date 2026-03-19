<template>
  <div :class="['w-full', props.maxWidthClass]">
    <div class="flex w-full items-center justify-between px-1 py-2">
      <div class="flex items-center gap-1">
        <Popover v-if="!isModelSelectionLocked" v-model:open="isModelPanelOpen">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
            >
              <ModelIcon
                :model-id="displayIconId"
                custom-class="w-3.5 h-3.5"
                :is-dark="themeStore.isDark"
              />
              <span>{{ displayModelText }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            :class="[
              'max-w-[calc(100vw-1rem)] overflow-hidden p-0',
              isModelSettingsExpanded ? 'w-[38rem]' : 'w-[20rem]'
            ]"
          >
            <div class="flex max-h-[28rem]">
              <div
                :class="[
                  'flex min-w-0 flex-col',
                  isModelSettingsExpanded ? 'w-[18rem] border-r' : 'w-full'
                ]"
              >
                <div class="border-b px-2.5 py-2">
                  <Input
                    data-model-search-input="true"
                    v-model="modelSearchKeyword"
                    class="h-7 border-0 bg-transparent px-3 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    :placeholder="t('model.search.placeholder')"
                  />
                </div>

                <div class="max-h-[24rem] overflow-y-auto px-2 py-2">
                  <div
                    v-if="filteredModelGroups.length === 0"
                    class="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    {{ t('chat.modelPicker.empty') }}
                  </div>

                  <div v-else class="space-y-3">
                    <div
                      v-for="group in filteredModelGroups"
                      :key="group.providerId"
                      class="space-y-1"
                    >
                      <div
                        class="px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        {{ group.providerName }}
                      </div>

                      <div class="space-y-1">
                        <div
                          v-for="model in group.models"
                          :key="`${group.providerId}-${model.id}`"
                          class="flex items-center gap-1"
                        >
                          <button
                            type="button"
                            :class="[
                              'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                              isModelSelected(group.providerId, model.id)
                                ? 'bg-muted/60 text-foreground'
                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                            ]"
                            @click="handleModelQuickSelect(group.providerId, model.id)"
                          >
                            <ModelIcon
                              :model-id="resolveModelIconId(group.providerId, model.id)"
                              custom-class="w-3.5 h-3.5 shrink-0"
                              :is-dark="themeStore.isDark"
                            />
                            <span class="min-w-0 flex-1 truncate font-medium">{{ model.id }}</span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            class="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                            :aria-label="t('chat.advancedSettings.button')"
                            :title="t('chat.advancedSettings.button')"
                            @click.stop="openModelSettings(group.providerId, model.id)"
                          >
                            <Icon icon="lucide:chevron-right" class="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="isModelSettingsExpanded" class="flex w-[21rem] min-w-0 flex-col">
                <div class="border-b px-3 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium">{{ t('settings.model.title') }}</div>
                      <div class="mt-1 truncate text-xs font-medium">
                        {{ modelSettingsModelName }}
                      </div>
                      <div class="truncate text-[11px] text-muted-foreground">
                        {{ modelSettingsProviderText }}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                      :aria-label="t('common.close')"
                      :title="t('common.close')"
                      @click="collapseModelSettings"
                    >
                      <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div class="max-h-[24rem] overflow-y-auto px-3 py-3">
                  <div
                    v-if="!isModelSettingsReady"
                    class="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    {{ t('common.loading') }}
                  </div>

                  <div v-else-if="localSettings" class="space-y-4">
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between gap-2">
                        <label class="text-xs font-medium">{{
                          t('chat.advancedSettings.temperature')
                        }}</label>
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
                        <label class="text-xs font-medium">{{
                          t('chat.advancedSettings.maxTokens')
                        }}</label>
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

                    <div v-if="showReasoningEffort" class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('settings.model.modelConfig.reasoningEffort.label')
                      }}</label>
                      <Select
                        :model-value="localSettings.reasoningEffort ?? effortOptions[0]?.value"
                        @update:model-value="onReasoningEffortSelect($event as string)"
                      >
                        <SelectTrigger class="h-8 text-xs">
                          <SelectValue
                            :placeholder="
                              t('settings.model.modelConfig.reasoningEffort.placeholder')
                            "
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="option in effortOptions"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div v-if="showVerbosity" class="space-y-1.5">
                      <label class="text-xs font-medium">{{
                        t('settings.model.modelConfig.verbosity.label')
                      }}</label>
                      <Select
                        :model-value="localSettings.verbosity ?? verbosityOptions[0]?.value"
                        @update:model-value="onVerbositySelect($event as string)"
                      >
                        <SelectTrigger class="h-8 text-xs">
                          <SelectValue
                            :placeholder="t('settings.model.modelConfig.verbosity.placeholder')"
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="option in verbosityOptions"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div v-if="showThinkingBudget" class="space-y-1.5">
                      <div class="flex items-center justify-between">
                        <label class="text-xs font-medium">{{
                          t('chat.advancedSettings.thinkingBudget')
                        }}</label>
                        <span class="text-[11px] text-muted-foreground">
                          {{ thinkingBudgetHint }}
                        </span>
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
                  </div>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          v-else
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          :disabled="true"
        >
          <ModelIcon
            :model-id="displayIconId"
            custom-class="w-3.5 h-3.5"
            :is-dark="themeStore.isDark"
          />
          <span>{{ displayModelText }}</span>
        </Button>
      </div>

      <div class="flex items-center gap-1">
        <McpIndicator
          :show-system-prompt-section="showSystemPromptSection"
          :system-prompt-options="systemPromptMenuOptions"
          :selected-system-prompt-id="selectedSystemPromptId"
          :show-custom-system-prompt-badge="selectedSystemPromptId === '__custom__'"
          @select-system-prompt="onSystemPromptSelect"
          @open-change="handleSessionPanelOpenChange"
        />

        <DropdownMenu v-if="canSelectPermissionMode">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              :class="[
                'h-6 px-2 gap-1.5 text-xs backdrop-blur-lg',
                permissionMode === 'full_access'
                  ? 'text-orange-500 hover:text-orange-600'
                  : 'text-muted-foreground hover:text-foreground'
              ]"
            >
              <Icon :icon="permissionIcon" class="w-3.5 h-3.5" />
              <span>{{ permissionModeLabel }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-48">
            <DropdownMenuItem
              v-for="option in permissionOptions"
              :key="option.value"
              class="gap-2 text-xs py-1.5 px-2"
              @select="selectPermissionMode(option.value)"
            >
              <Icon :icon="option.icon" :class="['h-3.5 w-3.5 shrink-0', option.iconClass]" />
              <span class="flex-1">{{ option.label }}</span>
              <Icon
                v-if="permissionMode === option.value"
                icon="lucide:check"
                class="h-3.5 w-3.5 shrink-0"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          v-else
          variant="ghost"
          size="sm"
          :class="[
            'h-6 px-2 gap-1.5 text-xs backdrop-blur-lg disabled:opacity-100',
            permissionMode === 'full_access'
              ? 'text-orange-500 hover:text-orange-600'
              : 'text-muted-foreground hover:text-foreground'
          ]"
          :disabled="true"
        >
          <Icon :icon="permissionIcon" class="w-3.5 h-3.5" />
          <span>{{ permissionModeLabel }}</span>
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Input } from '@shadcn/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Slider } from '@shadcn/components/ui/slider'
import type { RENDERER_MODEL_META, SystemPrompt } from '@shared/presenter'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { ReasoningPortrait } from '@shared/types/model-db'
import McpIndicator from '@/components/chat-input/McpIndicator.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'
import { useThemeStore } from '@/stores/theme'
import { useAgentStore } from '@/stores/ui/agent'
import { useDraftStore } from '@/stores/ui/draft'
import { useSessionStore } from '@/stores/ui/session'

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

type GroupedModelList = {
  providerId: string
  providerName: string
  models: RENDERER_MODEL_META[]
}

const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 2
const CONTEXT_LENGTH_MIN = 2048
const MAX_TOKENS_MIN = 128
const DEFAULT_REASONING_EFFORT_OPTIONS: SessionGenerationSettings['reasoningEffort'][] = [
  'minimal',
  'low',
  'medium',
  'high'
]
const DEFAULT_VERBOSITY_OPTIONS: SessionGenerationSettings['verbosity'][] = [
  'low',
  'medium',
  'high'
]

const themeStore = useThemeStore()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const configPresenter = usePresenter('configPresenter')
const newAgentPresenter = usePresenter('newAgentPresenter')
const { t } = useI18n()

const draftModelSelection = ref<ModelSelection | null>(null)
const permissionMode = ref<PermissionMode>('full_access')
const localSettings = ref<SessionGenerationSettings | null>(null)
const loadedSettingsSelection = ref<ModelSelection | null>(null)
const systemPromptList = ref<SystemPrompt[]>([])
const isModelPanelOpen = ref(false)
const isModelSettingsExpanded = ref(false)
const modelSearchKeyword = ref('')
const modelSettingsSelection = ref<ModelSelection | null>(null)

const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityReasoningPortrait = ref<ReasoningPortrait | null>(null)
const capabilityBudgetRange = ref<{ min?: number; max?: number; default?: number } | null>(null)
const capabilitySupportsEffort = ref<boolean | null>(null)
const capabilitySupportsVerbosity = ref<boolean | null>(null)

let draftModelSyncToken = 0
let permissionSyncToken = 0
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

const canSelectPermissionMode = computed(() => !isAcpAgent.value)

const providerNameMap = computed(() => {
  const map = new Map<string, string>()
  providerStore.sortedProviders.forEach((provider) => {
    map.set(provider.id, provider.name)
  })
  return map
})

const modelGroups = computed<GroupedModelList[]>(() => {
  const groupsById = new Map(
    modelStore.enabledModels
      .filter((group) => group.providerId !== 'acp')
      .map((group) => [group.providerId, group.models] as const)
  )

  const result: GroupedModelList[] = []

  providerStore.sortedProviders
    .filter((provider) => provider.enable && provider.id !== 'acp')
    .forEach((provider) => {
      const models = groupsById.get(provider.id)
      if (!models || models.length === 0) {
        return
      }
      result.push({
        providerId: provider.id,
        providerName: provider.name,
        models
      })
      groupsById.delete(provider.id)
    })

  Array.from(groupsById.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([providerId, models]) => {
      result.push({
        providerId,
        providerName: providerNameMap.value.get(providerId) ?? providerId,
        models
      })
    })

  return result
})

const filteredModelGroups = computed<GroupedModelList[]>(() => {
  const keyword = modelSearchKeyword.value.trim().toLowerCase()
  if (!keyword) {
    return modelGroups.value
  }

  return modelGroups.value
    .map((group) => {
      const providerMatched = `${group.providerName} ${group.providerId}`
        .toLowerCase()
        .includes(keyword)
      return {
        ...group,
        models: providerMatched
          ? group.models
          : group.models.filter((model) =>
              `${model.name} ${model.id}`.toLowerCase().includes(keyword)
            )
      }
    })
    .filter((group) => group.models.length > 0)
})

const modelSettingsTarget = computed<ModelSelection | null>(() => {
  return modelSettingsSelection.value ?? effectiveModelSelection.value
})

const permissionModeLabel = computed(() =>
  permissionMode.value === 'default'
    ? t('chat.permissionMode.default')
    : t('chat.permissionMode.fullAccess')
)

const permissionIcon = computed(() =>
  permissionMode.value === 'full_access' ? 'lucide:shield-alert' : 'lucide:shield'
)

const permissionOptions = computed(() => [
  {
    value: 'default' as const,
    label: t('chat.permissionMode.default'),
    icon: 'lucide:shield',
    iconClass: 'text-muted-foreground'
  },
  {
    value: 'full_access' as const,
    label: t('chat.permissionMode.fullAccess'),
    icon: 'lucide:shield-alert',
    iconClass: 'text-orange-500'
  }
])

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { providerId?: unknown; modelId?: unknown }
  return typeof candidate.providerId === 'string' && typeof candidate.modelId === 'string'
}

const isReasoningEffort = (value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' =>
  value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'

const isVerbosity = (value: unknown): value is 'low' | 'medium' | 'high' =>
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

const findEnabledModelMeta = (providerId: string, modelId: string): RENDERER_MODEL_META | null => {
  const group = modelStore.enabledModels.find((item) => item.providerId === providerId)
  return group?.models.find((model) => model.id === modelId) ?? null
}

const getReasoningEffortOptions = (
  portrait: ReasoningPortrait | null | undefined
): SessionGenerationSettings['reasoningEffort'][] => {
  if (
    !portrait ||
    portrait.mode === 'budget' ||
    portrait.mode === 'level' ||
    portrait.mode === 'fixed'
  ) {
    return []
  }

  const options = portrait?.effortOptions?.filter(isReasoningEffort)
  if (options && options.length > 0) {
    return options
  }
  return portrait.mode !== 'mixed' && isReasoningEffort(portrait?.effort)
    ? [...DEFAULT_REASONING_EFFORT_OPTIONS]
    : []
}

const getVerbosityOptions = (
  portrait: ReasoningPortrait | null | undefined
): SessionGenerationSettings['verbosity'][] => {
  const options = portrait?.verbosityOptions?.filter(isVerbosity)
  if (options && options.length > 0) {
    return options
  }
  return isVerbosity(portrait?.verbosity) ? [...DEFAULT_VERBOSITY_OPTIONS] : []
}

const supportsReasoningEffort = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getReasoningEffortOptions(portrait).length > 0

const supportsVerbosity = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getVerbosityOptions(portrait).length > 0

const hasThinkingBudgetSupport = (portrait: ReasoningPortrait | null | undefined): boolean =>
  Boolean(
    portrait &&
    portrait.mode !== 'effort' &&
    portrait.mode !== 'level' &&
    portrait.mode !== 'fixed' &&
    portrait.budget &&
    (portrait.budget.default !== undefined ||
      portrait.budget.min !== undefined ||
      portrait.budget.max !== undefined ||
      portrait.budget.auto !== undefined ||
      portrait.budget.off !== undefined)
  )

const normalizeReasoningEffort = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['reasoningEffort'] | undefined => {
  if (!isReasoningEffort(value)) {
    return undefined
  }

  const options = getReasoningEffortOptions(portrait)
  if (options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isReasoningEffort(portrait?.effort) && options.includes(portrait.effort)
    ? portrait.effort
    : undefined
}

const normalizeVerbosity = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['verbosity'] | undefined => {
  if (!isVerbosity(value)) {
    return undefined
  }

  const options = getVerbosityOptions(portrait)
  if (options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isVerbosity(portrait?.verbosity) && options.includes(portrait.verbosity)
    ? portrait.verbosity
    : undefined
}

const normalizeThinkingBudget = (
  portrait: ReasoningPortrait | null | undefined,
  value: number,
  min?: number,
  max?: number
): number => {
  const roundedValue = Math.round(value)
  const sentinelValues = new Set<number>()

  if (typeof portrait?.budget?.default === 'number')
    sentinelValues.add(Math.round(portrait.budget.default))
  if (typeof portrait?.budget?.auto === 'number')
    sentinelValues.add(Math.round(portrait.budget.auto))
  if (typeof portrait?.budget?.off === 'number') sentinelValues.add(Math.round(portrait.budget.off))

  if (sentinelValues.has(roundedValue)) {
    return roundedValue
  }

  let nextValue = roundedValue
  if (typeof min === 'number') {
    nextValue = Math.max(nextValue, Math.round(min))
  }
  if (typeof max === 'number') {
    nextValue = Math.min(nextValue, Math.round(max))
  }
  return nextValue
}

const findEnabledModel = (providerId: string, modelId: string): ModelSelection | null => {
  const hit = findEnabledModelMeta(providerId, modelId)
  if (!hit) {
    return null
  }
  return { providerId, modelId: hit.id }
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

const resolveModelName = (providerId?: string | null, modelId?: string | null): string => {
  if (!modelId) {
    return ''
  }
  if (providerId) {
    const hit = findEnabledModelMeta(providerId, modelId)
    if (hit) {
      return hit.name
    }
  }
  const found = modelStore.findModelByIdOrName(modelId)
  if (found) return found.model.name
  return modelId
}

const resolveModelIconId = (providerId?: string | null, modelId?: string | null): string => {
  if (providerId === 'acp' && modelId) {
    return modelId
  }
  return providerId || 'anthropic'
}

const clearPendingGenerationPersist = () => {
  if (generationPersistTimer) {
    clearTimeout(generationPersistTimer)
    generationPersistTimer = null
  }
  pendingGenerationPatch = {}
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

const budgetRange = computed(() => capabilityBudgetRange.value)

const thinkingBudgetHint = computed(() => {
  const value = localSettings.value?.thinkingBudget
  if (value === undefined) {
    return t('chat.advancedSettings.useDefault')
  }
  return String(value)
})

const showThinkingBudget = computed(() => {
  if (!localSettings.value) {
    return false
  }
  return (
    capabilitySupportsReasoning.value === true &&
    hasThinkingBudgetSupport(capabilityReasoningPortrait.value)
  )
})

const showVerbosity = computed(
  () =>
    !isAcpAgent.value &&
    supportsVerbosity(capabilityReasoningPortrait.value) &&
    Boolean(localSettings.value)
)

const showReasoningEffort = computed(
  () =>
    !isAcpAgent.value &&
    supportsReasoningEffort(capabilityReasoningPortrait.value) &&
    Boolean(localSettings.value)
)

const effortOptions = computed(() => {
  return getReasoningEffortOptions(capabilityReasoningPortrait.value).map((value) => ({
    value,
    label: t(`settings.model.modelConfig.reasoningEffort.options.${value}`)
  }))
})

const verbosityOptions = computed(() => {
  return getVerbosityOptions(capabilityReasoningPortrait.value).map((value) => ({
    value,
    label: t(`settings.model.modelConfig.verbosity.options.${value}`)
  }))
})

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

const systemPromptMenuOptions = computed(() =>
  systemPromptOptions.value.map((option) => ({
    id: option.id,
    label: option.label,
    disabled: option.disabled
  }))
)

const hasLoadedGenerationSettingsForCurrentSelection = computed(() => {
  const loadedSelection = loadedSettingsSelection.value
  const effectiveSelection = effectiveModelSelection.value

  return Boolean(
    localSettings.value &&
    loadedSelection &&
    effectiveSelection &&
    loadedSelection.providerId === effectiveSelection.providerId &&
    loadedSelection.modelId === effectiveSelection.modelId
  )
})

const selectedSystemPromptId = computed(() => {
  if (!hasLoadedGenerationSettingsForCurrentSelection.value || !localSettings.value) {
    return 'empty'
  }
  const currentPrompt = localSettings.value.systemPrompt
  const matched = systemPromptOptions.value.find((option) => option.content === currentPrompt)
  return matched?.id ?? 'empty'
})

const showSystemPromptSection = computed(
  () => !isAcpAgent.value && hasLoadedGenerationSettingsForCurrentSelection.value
)

const modelSettingsModelName = computed(() => {
  return resolveModelName(
    modelSettingsTarget.value?.providerId ?? null,
    modelSettingsTarget.value?.modelId ?? null
  )
})

const modelSettingsProviderText = computed(() => {
  const selection = modelSettingsTarget.value
  if (!selection) {
    return ''
  }
  const providerName = providerNameMap.value.get(selection.providerId) ?? selection.providerId
  return `${providerName} / ${selection.modelId}`
})

const isModelSettingsReady = computed(() => {
  if (!isModelSettingsExpanded.value) {
    return false
  }
  const target = modelSettingsTarget.value
  const effective = effectiveModelSelection.value
  const loadedSelection = loadedSettingsSelection.value
  if (!target || !effective) {
    return false
  }
  return (
    target.providerId === effective.providerId &&
    target.modelId === effective.modelId &&
    loadedSelection?.providerId === effective.providerId &&
    loadedSelection?.modelId === effective.modelId &&
    Boolean(localSettings.value)
  )
})

const displayIconId = computed(() => {
  if (hasActiveSession.value) {
    return resolveModelIconId(
      activeSessionSelection.value?.providerId || draftModelSelection.value?.providerId,
      activeSessionSelection.value?.modelId || draftModelSelection.value?.modelId
    )
  }
  if (isAcpAgent.value) {
    return resolveModelIconId('acp', agentStore.selectedAgentId)
  }
  return resolveModelIconId(
    draftModelSelection.value?.providerId,
    draftModelSelection.value?.modelId
  )
})

const displayModelText = computed(() => {
  if (hasActiveSession.value) {
    const selection = activeSessionSelection.value ?? draftModelSelection.value
    if (selection?.modelId) {
      return selection.modelId
    }
    return t('common.selectModel')
  }
  if (isAcpAgent.value) {
    return agentStore.selectedAgentId ?? 'ACP Agent'
  }
  const selection = draftModelSelection.value
  if (selection?.modelId) {
    return selection.modelId
  }
  return t('common.selectModel')
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
    const preferredModel = (await configPresenter.getSetting('preferredModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(preferredModel)) {
      const resolvedPreferred = findEnabledModel(preferredModel.providerId, preferredModel.modelId)
      if (resolvedPreferred) {
        applyDraftSelection(resolvedPreferred)
        return
      }
    }

    const defaultModel = (await configPresenter.getSetting('defaultModel')) as unknown
    if (token !== draftModelSyncToken) return
    if (isModelSelection(defaultModel)) {
      const resolvedDefault = findEnabledModel(defaultModel.providerId, defaultModel.modelId)
      if (resolvedDefault) {
        applyDraftSelection(resolvedDefault)
        return
      }
    }
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to resolve draft model:', error)
  }

  if (token !== draftModelSyncToken) return
  applyDraftSelection(pickFirstEnabledModel())
}

const resolveDefaultGenerationSettings = async (
  providerId: string,
  modelId: string
): Promise<SessionGenerationSettings> => {
  const modelConfig = configPresenter.getModelConfig(modelId, providerId)
  const defaultSystemPrompt = await configPresenter.getDefaultSystemPrompt()
  const portrait = (await configPresenter.getReasoningPortrait?.(providerId, modelId)) ?? null
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

  if (portrait?.supported === true && hasThinkingBudgetSupport(portrait)) {
    const range = portrait.budget ?? {}
    const defaultBudget = toFiniteNumber(modelConfig.thinkingBudget ?? range.default)
    if (defaultBudget !== undefined) {
      defaults.thinkingBudget = normalizeThinkingBudget(
        portrait,
        Math.round(defaultBudget),
        range.min,
        range.max
      )
    }
  }

  if (supportsReasoningEffort(portrait)) {
    const effort = normalizeReasoningEffort(
      portrait,
      modelConfig.reasoningEffort ?? portrait?.effort
    )
    if (effort) {
      defaults.reasoningEffort = effort
    }
  }

  if (supportsVerbosity(portrait)) {
    const verbosity = normalizeVerbosity(portrait, modelConfig.verbosity ?? portrait?.verbosity)
    if (verbosity) {
      defaults.verbosity = verbosity
    }
  }

  return defaults
}

const mergeDraftOverrides = (
  defaults: SessionGenerationSettings,
  portrait: ReasoningPortrait | null
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
      ? {
          reasoningEffort: normalizeReasoningEffort(portrait, draftStore.reasoningEffort)
        }
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

  if (next.thinkingBudget !== undefined) {
    next.thinkingBudget = normalizeThinkingBudget(
      portrait,
      next.thinkingBudget,
      portrait?.budget?.min,
      portrait?.budget?.max
    )
  }

  if (next.reasoningEffort !== undefined) {
    next.reasoningEffort = normalizeReasoningEffort(portrait, next.reasoningEffort)
  }

  if (next.verbosity !== undefined) {
    next.verbosity = normalizeVerbosity(portrait, next.verbosity)
  }

  return next
}

const fetchCapabilities = async (providerId: string, modelId: string): Promise<void> => {
  try {
    const portrait = (await configPresenter.getReasoningPortrait?.(providerId, modelId)) ?? null

    capabilityReasoningPortrait.value = portrait
    capabilitySupportsReasoning.value =
      typeof portrait?.supported === 'boolean' ? portrait.supported : null
    capabilityBudgetRange.value = portrait?.budget
      ? {
          ...(typeof portrait.budget.min === 'number' ? { min: portrait.budget.min } : {}),
          ...(typeof portrait.budget.max === 'number' ? { max: portrait.budget.max } : {}),
          ...(typeof portrait.budget.default === 'number'
            ? { default: portrait.budget.default }
            : {})
        }
      : null
    capabilitySupportsEffort.value = supportsReasoningEffort(portrait)
    capabilitySupportsVerbosity.value = supportsVerbosity(portrait)
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to fetch model capabilities:', error)
    capabilitySupportsReasoning.value = null
    capabilityReasoningPortrait.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilitySupportsVerbosity.value = null
  }
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
  loadedSettingsSelection.value = null

  if (isAcpAgent.value) {
    localSettings.value = null
    loadedSettingsSelection.value = null
    capabilitySupportsReasoning.value = null
    capabilityReasoningPortrait.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilitySupportsVerbosity.value = null
    return
  }

  const selection = effectiveModelSelection.value
  if (!selection) {
    localSettings.value = null
    loadedSettingsSelection.value = null
    capabilityReasoningPortrait.value = null
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilitySupportsVerbosity.value = null
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
        loadedSettingsSelection.value = { ...selection }
      } else {
        const defaults = await resolveDefaultGenerationSettings(
          selection.providerId,
          selection.modelId
        )
        if (token !== generationSyncToken) {
          return
        }
        localSettings.value = defaults
        loadedSettingsSelection.value = { ...selection }
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
  localSettings.value = mergeDraftOverrides(defaults, capabilityReasoningPortrait.value)
  loadedSettingsSelection.value = { ...selection }
}

const reloadSystemPrompts = async () => {
  try {
    systemPromptList.value = await configPresenter.getSystemPrompts()
  } catch (error) {
    console.warn('[ChatStatusBar] Failed to load system prompt options:', error)
    systemPromptList.value = []
  }
}

watch(
  [hasActiveSession, isAcpAgent, () => agentStore.selectedAgentId, () => modelStore.enabledModels],
  () => {
    if (hasActiveSession.value) return
    void syncDraftModelSelection()
  },
  { immediate: true, deep: true }
)

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

function getEffectiveModelSelectionSnapshot(): ModelSelection | null {
  return effectiveModelSelection.value ? { ...effectiveModelSelection.value } : null
}

watch(isModelPanelOpen, (open) => {
  if (open) {
    modelSearchKeyword.value = ''
    isModelSettingsExpanded.value = false
    modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()

    void nextTick(() => {
      const input = document.querySelector<HTMLInputElement>('[data-model-search-input="true"]')
      input?.focus()
    })
    return
  }

  modelSearchKeyword.value = ''
  isModelSettingsExpanded.value = false
  modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()
})

onBeforeUnmount(() => {
  clearPendingGenerationPersist()
})

function isModelSelected(providerId: string, modelId: string) {
  return (
    effectiveModelSelection.value?.providerId === providerId &&
    effectiveModelSelection.value?.modelId === modelId
  )
}

async function changeModelSelection(providerId: string, modelId: string): Promise<boolean> {
  if (isModelSelectionLocked.value) {
    return false
  }

  if (
    effectiveModelSelection.value?.providerId === providerId &&
    effectiveModelSelection.value?.modelId === modelId
  ) {
    return true
  }

  if (hasActiveSession.value) {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) {
      return false
    }
    try {
      await sessionStore.setSessionModel(sessionId, providerId, modelId)
      return true
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to switch active session model:', error)
      return false
    }
  }

  const previousDraftSelection = draftModelSelection.value ? { ...draftModelSelection.value } : null
  const previousDraftProviderId = draftStore.providerId
  const previousDraftModelId = draftStore.modelId

  try {
    draftModelSelection.value = { providerId, modelId }
    draftStore.providerId = providerId
    draftStore.modelId = modelId
    await configPresenter.setSetting('preferredModel', { providerId, modelId })
    return true
  } catch (error) {
    draftModelSelection.value = previousDraftSelection
    draftStore.providerId = previousDraftProviderId
    draftStore.modelId = previousDraftModelId
    console.warn('[ChatStatusBar] Failed to switch draft model:', error)
    return false
  }
}

async function handleModelQuickSelect(providerId: string, modelId: string) {
  const changed = await changeModelSelection(providerId, modelId)
  if (!changed) {
    return
  }

  modelSettingsSelection.value = { providerId, modelId }
  isModelSettingsExpanded.value = false
  isModelPanelOpen.value = false
}

async function openModelSettings(providerId: string, modelId: string) {
  const changed = await changeModelSelection(providerId, modelId)
  if (!changed) {
    modelSettingsSelection.value = getEffectiveModelSelectionSnapshot()
    isModelSettingsExpanded.value = false
    return
  }

  modelSettingsSelection.value = { providerId, modelId }
  isModelSettingsExpanded.value = true
}

function collapseModelSettings() {
  isModelSettingsExpanded.value = false
}

function handleSessionPanelOpenChange(open: boolean) {
  if (!open || !showSystemPromptSection.value) {
    return
  }
  void reloadSystemPrompts()
}

function onSystemPromptSelect(optionId: string) {
  if (!hasLoadedGenerationSettingsForCurrentSelection.value || !localSettings.value) {
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
  const budget = normalizeThinkingBudget(
    capabilityReasoningPortrait.value,
    Math.round(numeric),
    range?.min,
    range?.max
  )
  updateLocalGenerationSettings({ thinkingBudget: budget })
}

function onReasoningEffortSelect(value: string) {
  if (!localSettings.value) {
    return
  }

  const normalized = normalizeReasoningEffort(capabilityReasoningPortrait.value, value)
  if (!normalized) {
    return
  }
  updateLocalGenerationSettings({ reasoningEffort: normalized })
}

function onVerbositySelect(value: string) {
  if (!localSettings.value) {
    return
  }
  const normalized = normalizeVerbosity(capabilityReasoningPortrait.value, value)
  if (!normalized) {
    return
  }
  updateLocalGenerationSettings({ verbosity: normalized })
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

defineExpose({
  localSettings,
  permissionMode,
  showSystemPromptSection,
  showReasoningEffort,
  onTemperatureSlider,
  selectModel: changeModelSelection,
  openModelSettings,
  isModelSettingsExpanded,
  modelSettingsSelection
})
</script>
