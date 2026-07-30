<template>
  <section
    v-if="open"
    class="overflow-hidden rounded-lg border border-border bg-card"
    data-testid="settings-memory-config-panel"
  >
    <header class="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          {{ t('settings.memory.redesign.configTitle') }}
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.configDescription') }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span v-if="saving" class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner class="size-3.5" />
          {{ t('common.saving') }}
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :disabled="saving || closing"
          :aria-label="t('common.close')"
          data-testid="settings-memory-config-close"
          @click="requestClose"
        >
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>
    </header>

    <div
      class="max-h-[62vh] overflow-y-auto p-4"
      :class="closing ? 'pointer-events-none opacity-70' : ''"
      :aria-busy="closing"
      :inert="closing"
    >
      <MemoryInlineFeedback
        v-if="feedback"
        class="mb-4"
        :feedback="feedback"
        @clear="clearPanelFeedback"
      />

      <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
        {{ t('common.loading') }}
      </div>

      <div v-else class="space-y-4">
        <section class="space-y-3 rounded-lg border border-border p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold">
                {{ t('settings.deepchatAgents.memoryTitle') }}
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryDescription') }}
              </p>
            </div>
            <Switch
              :model-value="form.memoryEnabled"
              :aria-label="t('settings.deepchatAgents.memoryEnabled')"
              @update:model-value="submitBoolean('memoryEnabled', $event)"
            />
          </div>
        </section>

        <template v-if="form.memoryEnabled">
          <section class="space-y-4 rounded-lg border border-border p-4">
            <div class="space-y-1.5">
              <div class="text-[11px] font-medium text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryEmbeddingModel') }}
              </div>
              <Popover v-model:open="embeddingOpen">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-8 w-full justify-between gap-2 text-xs"
                  >
                    <span class="flex min-w-0 items-center gap-1.5">
                      <ModelIcon
                        v-if="form.memoryEmbedding?.modelId"
                        :model-id="form.memoryEmbedding.modelId"
                        custom-class="h-3.5 w-3.5 shrink-0"
                      />
                      <Icon
                        v-else
                        icon="lucide:box"
                        class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                      <span class="truncate">{{ modelLabel(form.memoryEmbedding) }}</span>
                    </span>
                    <Icon
                      icon="lucide:chevron-down"
                      class="h-3 w-3 shrink-0 text-muted-foreground"
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent class="w-[320px] p-0" align="start">
                  <div class="flex items-center justify-between border-b px-3 py-2">
                    <div class="text-sm font-medium">
                      {{ t('settings.deepchatAgents.memoryEmbeddingModel') }}
                    </div>
                    <Button
                      v-if="form.memoryEmbedding"
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      @click="submitModel('memoryEmbedding', null)"
                    >
                      {{ t('common.clear') }}
                    </Button>
                  </div>
                  <ModelSelect
                    :exclude-providers="['acp']"
                    :respect-chat-mode="false"
                    :type="[ModelType.Embedding]"
                    @update:model="
                      (model, providerId) =>
                        submitModel('memoryEmbedding', { providerId, modelId: model.id })
                    "
                  />
                </PopoverContent>
              </Popover>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryEmbeddingHint') }}
              </p>
            </div>

            <Collapsible v-model:open="advancedOpen" class="rounded-lg border border-border/70">
              <CollapsibleTrigger
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
              >
                <span>
                  <span class="block text-sm font-semibold">
                    {{ t('settings.memory.config.advancedTitle') }}
                  </span>
                  <span class="mt-0.5 block text-xs text-muted-foreground">
                    {{ t('settings.memory.config.advancedHint') }}
                  </span>
                </span>
                <Icon
                  :icon="advancedOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                  class="h-4 w-4 shrink-0 text-muted-foreground"
                />
              </CollapsibleTrigger>
              <CollapsibleContent class="space-y-4 border-t border-border/70 p-3">
                <div class="space-y-1.5">
                  <div class="text-[11px] font-medium text-muted-foreground">
                    {{ t('settings.memory.config.extractionModel') }}
                  </div>
                  <Popover v-model:open="extractionOpen">
                    <PopoverTrigger as-child>
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-8 w-full justify-between gap-2 text-xs"
                      >
                        <span class="flex min-w-0 items-center gap-1.5">
                          <ModelIcon
                            v-if="form.memoryExtractionModel?.modelId"
                            :model-id="form.memoryExtractionModel.modelId"
                            custom-class="h-3.5 w-3.5 shrink-0"
                          />
                          <Icon
                            v-else
                            icon="lucide:box"
                            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span class="truncate">{{ modelLabel(form.memoryExtractionModel) }}</span>
                        </span>
                        <Icon
                          icon="lucide:chevron-down"
                          class="h-3 w-3 shrink-0 text-muted-foreground"
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent class="w-[320px] p-0" align="start">
                      <div class="flex items-center justify-between border-b px-3 py-2">
                        <div class="text-sm font-medium">
                          {{ t('settings.memory.config.extractionModel') }}
                        </div>
                        <Button
                          v-if="form.memoryExtractionModel"
                          variant="ghost"
                          size="sm"
                          class="h-7 px-2 text-xs"
                          @click="submitModel('memoryExtractionModel', null)"
                        >
                          {{ t('common.clear') }}
                        </Button>
                      </div>
                      <ModelSelect
                        :exclude-providers="['acp']"
                        :respect-chat-mode="false"
                        @update:model="
                          (model, providerId) =>
                            submitModel('memoryExtractionModel', { providerId, modelId: model.id })
                        "
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <label class="block space-y-1.5">
                  <span class="text-[11px] font-medium text-muted-foreground">
                    {{ t('settings.memory.config.injectionBudget') }}
                  </span>
                  <Input
                    v-model="form.injectionBudget"
                    inputmode="numeric"
                    class="h-8 text-xs"
                    :placeholder="String(resolvedBudget)"
                    @blur="submitBudget"
                    @keydown.enter.prevent="submitBudget"
                  />
                  <span class="block text-[10px] text-muted-foreground">
                    {{
                      t('settings.memory.config.injectionBudgetHint', { default: DEFAULTS.budget })
                    }}
                    {{ t('settings.memory.config.inheritedHint') }}
                  </span>
                </label>

                <section class="space-y-3 rounded-lg border border-border p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-sm font-semibold">
                        {{ t('settings.memory.config.retrievalTitle') }}
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {{ t('settings.memory.config.retrievalHint') }}
                      </p>
                    </div>
                    <Switch
                      :model-value="form.overrideRetrieval"
                      :aria-label="t('settings.memory.config.retrievalOverride')"
                      @update:model-value="submitRetrievalOverride"
                    />
                  </div>
                  <p class="text-[11px] text-muted-foreground">
                    {{ t('settings.memory.redesign.relativeWeightsHint') }}
                  </p>
                  <div
                    class="grid gap-3 sm:grid-cols-2"
                    :class="form.overrideRetrieval ? '' : 'pointer-events-none opacity-50'"
                  >
                    <label v-for="field in retrievalFields" :key="field.key" class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t(field.labelKey) }}
                      </span>
                      <Input
                        v-model="form.retrieval[field.key]"
                        :disabled="!form.overrideRetrieval"
                        :inputmode="field.decimal ? 'decimal' : 'numeric'"
                        class="h-8 text-xs"
                        :placeholder="String(field.placeholder)"
                        @blur="submitRetrieval"
                        @keydown.enter.prevent="submitRetrieval"
                      />
                    </label>
                  </div>
                </section>
              </CollapsibleContent>
            </Collapsible>
          </section>

          <section class="space-y-2 rounded-lg border border-border p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold">
                  {{ t('settings.deepchatAgents.personaEvolutionTitle') }}
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ t('settings.deepchatAgents.personaEvolutionDescription') }}
                </p>
              </div>
              <Switch
                :model-value="form.personaEvolutionEnabled"
                :aria-label="t('settings.deepchatAgents.personaEvolutionTitle')"
                @update:model-value="submitBoolean('personaEvolutionEnabled', $event)"
              />
            </div>
            <p class="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {{ t('settings.deepchatAgents.personaEvolutionWarning') }}
            </p>
          </section>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import { Input } from '@shadcn/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Switch } from '@shadcn/components/ui/switch'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import ModelSelect from '@/components/ModelSelect.vue'
import { useModelStore } from '@/stores/modelStore'
import { createConfigClient } from '@api/ConfigClient'
import { ModelType } from '@shared/model'
import type {
  DeepChatAgentConfig,
  DeepChatAgentModelSelection
} from '@shared/types/agent-interface'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import { useMemoryInlineFeedback } from '../lib/useMemoryInlineFeedback'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const DEFAULTS = {
  topK: 6,
  rrfK: 60,
  similarityThreshold: 0.2,
  weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
  budget: 1200
}
const LIMITS = {
  topK: { min: 1, max: 100 },
  rrfK: { min: 1, max: 1000 },
  budget: { min: 64, max: 8000 }
}

type EditableModel = { providerId: string; modelId: string } | null
type RetrievalFormConfig = {
  topK: number
  rrfK: number
  similarityThreshold: number
  weights: {
    similarity: number
    recency: number
    importance: number
  }
}

const props = defineProps<{ open: boolean; agentId: string }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'pending-change': [pending: boolean]
  saved: []
}>()

const { t } = useI18n()
const configClient = createConfigClient()
const modelStore = useModelStore()
const panelFeedback = useMemoryInlineFeedback('MemoryConfigInlinePanel')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear

const loading = ref(false)
const closing = ref(false)
const failedKeys = ref<ReadonlySet<string>>(new Set())
const embeddingOpen = ref(false)
const extractionOpen = ref(false)
const advancedOpen = ref(false)
const originalConfig = ref<DeepChatAgentConfig>({})
const resolvedConfig = ref<DeepChatAgentConfig | null>(null)
const requestVersions = new Map<string, number>()
// Serializes writes per config key so a clear can never overtake its preceding set on the wire.
const submitChains = new Map<string, Promise<void>>()
const pendingCounts = ref<ReadonlyMap<string, number>>(new Map())
let loadRequestId = 0

const saving = computed(() => (pendingCounts.value.get(props.agentId) ?? 0) > 0)
const hasSaveFailure = computed(() => failedKeys.value.size > 0)

const form = reactive({
  memoryEnabled: false,
  personaEvolutionEnabled: false,
  memoryEmbedding: null as EditableModel,
  memoryExtractionModel: null as EditableModel,
  injectionBudget: '',
  overrideRetrieval: false,
  retrieval: {
    topK: '',
    rrfK: '',
    similarityThreshold: '',
    weightSimilarity: '',
    weightRecency: '',
    weightImportance: ''
  }
})

const retrievalFields = [
  {
    key: 'topK',
    labelKey: 'settings.memory.config.topK',
    placeholder: DEFAULTS.topK,
    decimal: false
  },
  {
    key: 'rrfK',
    labelKey: 'settings.memory.config.rrfK',
    placeholder: DEFAULTS.rrfK,
    decimal: false
  },
  {
    key: 'similarityThreshold',
    labelKey: 'settings.memory.config.similarityThreshold',
    placeholder: DEFAULTS.similarityThreshold,
    decimal: true
  },
  {
    key: 'weightSimilarity',
    labelKey: 'settings.memory.config.weightSimilarity',
    placeholder: DEFAULTS.weights.similarity,
    decimal: true
  },
  {
    key: 'weightRecency',
    labelKey: 'settings.memory.config.weightRecency',
    placeholder: DEFAULTS.weights.recency,
    decimal: true
  },
  {
    key: 'weightImportance',
    labelKey: 'settings.memory.config.weightImportance',
    placeholder: DEFAULTS.weights.importance,
    decimal: true
  }
] as const

const resolvedBudget = computed(
  () => resolvedConfig.value?.memoryInjectionTokenBudget ?? DEFAULTS.budget
)

function scopedKey(agentId: string, key: string): string {
  return `${agentId}:${key}`
}

function adjustPending(agentId: string, delta: 1 | -1): void {
  const next = new Map(pendingCounts.value)
  const count = Math.max(0, (next.get(agentId) ?? 0) + delta)
  if (count > 0) next.set(agentId, count)
  else next.delete(agentId)
  pendingCounts.value = next
}

function setKeyFailed(key: string, failed: boolean): void {
  const next = new Set(failedKeys.value)
  if (failed) next.add(key)
  else next.delete(key)
  failedKeys.value = next
}

function clearPanelFeedback(): void {
  failedKeys.value = new Set()
  clearFeedback()
}

function nextVersion(agentId: string, key: string): number {
  const versionKey = scopedKey(agentId, key)
  const version = (requestVersions.get(versionKey) ?? 0) + 1
  requestVersions.set(versionKey, version)
  return version
}

function isLatest(agentId: string, key: string, version: number): boolean {
  return requestVersions.get(scopedKey(agentId, key)) === version
}

function toEditableModel(selection: DeepChatAgentModelSelection | null | undefined): EditableModel {
  return selection ? { providerId: selection.providerId, modelId: selection.modelId } : null
}

function modelLabel(selection: EditableModel): string {
  if (!selection?.providerId || !selection?.modelId) return t('common.selectModel')
  const providerModels = modelStore.allProviderModels.find(
    (entry) => entry.providerId === selection.providerId
  )
  const matched = providerModels?.models.find((model) => model.id === selection.modelId)
  if (matched) return matched.name || matched.id
  const fallback = modelStore.findModelByIdOrName(selection.modelId)
  return fallback?.model.name || selection.modelId
}

function seedRetrieval(source: DeepChatAgentConfig['memoryRetrieval'] | undefined): void {
  const weights = source?.weights ?? DEFAULTS.weights
  form.retrieval.topK = String(source?.topK ?? DEFAULTS.topK)
  form.retrieval.rrfK = String(source?.rrfK ?? DEFAULTS.rrfK)
  form.retrieval.similarityThreshold = String(
    source?.similarityThreshold ?? DEFAULTS.similarityThreshold
  )
  form.retrieval.weightSimilarity = String(weights.similarity)
  form.retrieval.weightRecency = String(weights.recency)
  form.retrieval.weightImportance = String(weights.importance)
}

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function clampFloat(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function buildRetrieval(): RetrievalFormConfig {
  return {
    topK: clampInt(form.retrieval.topK, DEFAULTS.topK, LIMITS.topK.min, LIMITS.topK.max),
    rrfK: clampInt(form.retrieval.rrfK, DEFAULTS.rrfK, LIMITS.rrfK.min, LIMITS.rrfK.max),
    similarityThreshold: clampFloat(
      form.retrieval.similarityThreshold,
      DEFAULTS.similarityThreshold,
      0,
      1
    ),
    weights: {
      similarity: clampFloat(form.retrieval.weightSimilarity, DEFAULTS.weights.similarity, 0, 1e6),
      recency: clampFloat(form.retrieval.weightRecency, DEFAULTS.weights.recency, 0, 1e6),
      importance: clampFloat(form.retrieval.weightImportance, DEFAULTS.weights.importance, 0, 1e6)
    }
  }
}

function retrievalEqual(a: RetrievalFormConfig | null, b: RetrievalFormConfig | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.topK === b.topK &&
    a.rrfK === b.rrfK &&
    a.similarityThreshold === b.similarityThreshold &&
    a.weights.similarity === b.weights.similarity &&
    a.weights.recency === b.weights.recency &&
    a.weights.importance === b.weights.importance
  )
}

function committedRetrieval(): RetrievalFormConfig | null {
  const stored = originalConfig.value.memoryRetrieval
  if (!stored) return null
  const weights = stored.weights ?? DEFAULTS.weights
  return {
    topK: stored.topK ?? DEFAULTS.topK,
    rrfK: stored.rrfK ?? DEFAULTS.rrfK,
    similarityThreshold: stored.similarityThreshold ?? DEFAULTS.similarityThreshold,
    weights: {
      similarity: weights.similarity,
      recency: weights.recency,
      importance: weights.importance
    }
  }
}

const draftDirty = computed(() => {
  if (!props.open || loading.value) return false
  const rawBudget = form.injectionBudget.trim()
  const budget = rawBudget
    ? clampInt(rawBudget, DEFAULTS.budget, LIMITS.budget.min, LIMITS.budget.max)
    : null
  if (budget !== (originalConfig.value.memoryInjectionTokenBudget ?? null)) return true
  const retrieval = form.overrideRetrieval ? buildRetrieval() : null
  return !retrievalEqual(retrieval, committedRetrieval())
})

function applyOverride<K extends keyof DeepChatAgentConfig>(
  patch: DeepChatAgentConfig,
  key: K,
  value: DeepChatAgentConfig[K] | null
): void {
  if (value != null) {
    patch[key] = value
  } else if (key in originalConfig.value) {
    patch[key] = null as DeepChatAgentConfig[K]
  }
}

function syncOriginalConfig(patch: DeepChatAgentConfig): void {
  const next = { ...originalConfig.value }
  const nextRecord = next as Record<string, unknown>
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof DeepChatAgentConfig, DeepChatAgentConfig[keyof DeepChatAgentConfig] | null]
  >) {
    if (value == null) {
      delete nextRecord[key]
    } else {
      nextRecord[key] = value
    }
  }
  originalConfig.value = next
}

async function fetchAgentConfig(
  agentId: string
): Promise<{ config: DeepChatAgentConfig; resolved: DeepChatAgentConfig }> {
  const [agents, resolvedAgentConfig] = await Promise.all([
    configClient.listAgents(),
    configClient.resolveDeepChatAgentConfig(agentId)
  ])
  const resolved = resolvedAgentConfig as DeepChatAgentConfig
  const config = agents.find((agent) => agent.id === agentId)?.config ?? {}
  return { config, resolved }
}

function applyLoadedConfig(config: DeepChatAgentConfig, resolved: DeepChatAgentConfig): void {
  originalConfig.value = { ...config }
  resolvedConfig.value = resolved
  form.memoryEnabled = resolved.memoryEnabled ?? false
  form.personaEvolutionEnabled = resolved.personaEvolutionEnabled ?? false
  form.memoryEmbedding = toEditableModel(config.memoryEmbedding)
  form.memoryExtractionModel = toEditableModel(config.memoryExtractionModel)
  form.injectionBudget =
    config.memoryInjectionTokenBudget != null ? String(config.memoryInjectionTokenBudget) : ''
  form.overrideRetrieval = config.memoryRetrieval != null
  seedRetrieval(config.memoryRetrieval ?? resolved.memoryRetrieval ?? undefined)
}

async function load(): Promise<void> {
  if (!props.agentId || !props.open) return
  const agentId = props.agentId
  const current = ++loadRequestId
  clearPanelFeedback()
  loading.value = true
  try {
    const { config, resolved } = await fetchAgentConfig(agentId)
    if (current !== loadRequestId || props.agentId !== agentId || !props.open) return
    applyLoadedConfig(config, resolved)
  } catch (error) {
    if (current !== loadRequestId || props.agentId !== agentId || !props.open) return
    console.error('[MemoryConfigInlinePanel] Failed to load config', error)
    panelFeedback.show('error', t('settings.memory.redesign.configLoadFailed'))
  } finally {
    if (current === loadRequestId) loading.value = false
  }
}

// On save failure, resync only the affected field's form value and originalConfig entry from the
// server instead of reloading the whole form (which would clobber other in-flight optimistic edits).
function resetField(key: string, config: DeepChatAgentConfig, resolved: DeepChatAgentConfig): void {
  const next = { ...originalConfig.value } as Record<string, unknown>
  const configRecord = config as Record<string, unknown>
  if (configRecord[key] != null) {
    next[key] = configRecord[key]
  } else {
    delete next[key]
  }
  originalConfig.value = next as DeepChatAgentConfig

  switch (key) {
    case 'memoryEnabled':
      form.memoryEnabled = resolved.memoryEnabled ?? false
      break
    case 'personaEvolutionEnabled':
      form.personaEvolutionEnabled = resolved.personaEvolutionEnabled ?? false
      break
    case 'memoryEmbedding':
      form.memoryEmbedding = toEditableModel(config.memoryEmbedding)
      break
    case 'memoryExtractionModel':
      form.memoryExtractionModel = toEditableModel(config.memoryExtractionModel)
      break
    case 'memoryInjectionTokenBudget':
      form.injectionBudget =
        config.memoryInjectionTokenBudget != null ? String(config.memoryInjectionTokenBudget) : ''
      break
    case 'memoryRetrieval':
      form.overrideRetrieval = config.memoryRetrieval != null
      seedRetrieval(config.memoryRetrieval ?? resolved.memoryRetrieval ?? undefined)
      break
    default:
      break
  }
}

async function resetFieldFromServer(
  agentId: string,
  key: string,
  version: number,
  fallbackConfig: DeepChatAgentConfig,
  fallbackResolved: DeepChatAgentConfig
): Promise<void> {
  try {
    const { config, resolved } = await fetchAgentConfig(agentId)
    if (!isLatest(agentId, key, version) || props.agentId !== agentId || !props.open) return
    resetField(key, config, resolved)
  } catch (error) {
    console.error('[MemoryConfigInlinePanel] Failed to resync config field', error)
    if (!isLatest(agentId, key, version) || props.agentId !== agentId || !props.open) return
    resetField(key, fallbackConfig, fallbackResolved)
  }
}

async function runSubmit(
  agentId: string,
  key: string,
  version: number,
  patch: DeepChatAgentConfig
): Promise<void> {
  const fallbackConfig = originalConfig.value
  const fallbackResolved = resolvedConfig.value ?? fallbackConfig
  // Merge optimistically before the request settles so a same-key clear issued while this set is
  // still in flight sees the pending value and produces an explicit null patch instead of a no-op.
  if (props.agentId === agentId && props.open) {
    syncOriginalConfig(patch)
  }
  try {
    await configClient.updateDeepChatAgent(agentId, { config: patch })
    if (!isLatest(agentId, key, version) || props.agentId !== agentId || !props.open) return
    setKeyFailed(key, false)
    emit('saved')
  } catch (error) {
    if (!isLatest(agentId, key, version) || props.agentId !== agentId || !props.open) return
    setKeyFailed(key, true)
    console.error('[MemoryConfigInlinePanel] Failed to save config', error)
    panelFeedback.show('error', t('settings.memory.redesign.configSaveFailed'))
    await resetFieldFromServer(agentId, key, version, fallbackConfig, fallbackResolved)
  }
}

function submitPatch(key: string, patch: DeepChatAgentConfig): Promise<void> {
  const agentId = props.agentId
  const chainKey = scopedKey(agentId, key)
  const version = nextVersion(agentId, key)
  const previous = submitChains.get(chainKey) ?? Promise.resolve()
  const retryingFailedKey = failedKeys.value.has(key)
  setKeyFailed(key, false)
  if (retryingFailedKey || failedKeys.value.size === 0) clearFeedback()
  adjustPending(agentId, 1)
  const chained = previous.then(
    () => runSubmit(agentId, key, version, patch),
    () => runSubmit(agentId, key, version, patch)
  )
  const tracked = chained.finally(() => {
    adjustPending(agentId, -1)
    if (submitChains.get(chainKey) === tracked) {
      submitChains.delete(chainKey)
      requestVersions.delete(chainKey)
    }
  })
  submitChains.set(chainKey, tracked)
  return tracked
}

function submitBoolean(key: 'memoryEnabled' | 'personaEvolutionEnabled', value: boolean): void {
  form[key] = value
  void submitPatch(key, { [key]: value })
}

function submitModel(key: 'memoryEmbedding' | 'memoryExtractionModel', value: EditableModel): void {
  form[key] = value
  embeddingOpen.value = false
  extractionOpen.value = false
  const patch: DeepChatAgentConfig = {}
  const selection = value ? { providerId: value.providerId, modelId: value.modelId } : null
  if (key === 'memoryEmbedding') {
    applyOverride(patch, 'memoryEmbedding', selection)
  } else {
    applyOverride(patch, 'memoryExtractionModel', selection)
  }
  void submitPatch(key, patch)
}

function submitBudget(): void {
  const raw = form.injectionBudget.trim()
  const budget = raw ? clampInt(raw, DEFAULTS.budget, LIMITS.budget.min, LIMITS.budget.max) : null
  form.injectionBudget = budget == null ? '' : String(budget)
  if (budget === (originalConfig.value.memoryInjectionTokenBudget ?? null)) return
  const patch: DeepChatAgentConfig = {}
  applyOverride(patch, 'memoryInjectionTokenBudget', budget)
  void submitPatch('memoryInjectionTokenBudget', patch)
}

function submitRetrievalOverride(value: boolean): void {
  form.overrideRetrieval = value
  if (value && !form.retrieval.topK) seedRetrieval(resolvedConfig.value?.memoryRetrieval)
  submitRetrieval()
}

function submitRetrieval(): void {
  const patch: DeepChatAgentConfig = {}
  const retrieval = form.overrideRetrieval ? buildRetrieval() : null
  if (retrieval) {
    form.retrieval.topK = String(retrieval.topK)
    form.retrieval.rrfK = String(retrieval.rrfK)
    form.retrieval.similarityThreshold = String(retrieval.similarityThreshold)
    form.retrieval.weightSimilarity = String(retrieval.weights.similarity)
    form.retrieval.weightRecency = String(retrieval.weights.recency)
    form.retrieval.weightImportance = String(retrieval.weights.importance)
  }
  if (retrievalEqual(retrieval, committedRetrieval())) return
  applyOverride(patch, 'memoryRetrieval', retrieval)
  void submitPatch('memoryRetrieval', patch)
}

function discardDraft(): void {
  applyLoadedConfig(originalConfig.value, resolvedConfig.value ?? originalConfig.value)
  clearPanelFeedback()
}

async function requestClose(): Promise<void> {
  if (closing.value) return
  const mustSettleDraft = saving.value || draftDirty.value
  if (!mustSettleDraft) {
    clearPanelFeedback()
    emit('update:open', false)
    return
  }

  const agentId = props.agentId
  closing.value = true
  try {
    await waitForAgentSubmissions(agentId)
    if (props.agentId !== agentId || !props.open) return
    if (draftDirty.value) {
      submitBudget()
      submitRetrieval()
      await waitForAgentSubmissions(agentId)
    }
    if (props.agentId === agentId && props.open && feedback.value?.tone !== 'error') {
      emit('update:open', false)
    }
  } finally {
    closing.value = false
  }
}

async function waitForAgentSubmissions(agentId: string): Promise<void> {
  const prefix = `${agentId}:`
  const pending = Array.from(submitChains.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, promise]) => promise)
  await Promise.all(pending)
}

defineExpose({ requestClose })

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'memory-config',
  onDiscard: discardDraft
})
const stopLeaveRiskSync = watch(
  [saving, draftDirty, hasSaveFailure],
  ([busy, dirty, failed]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty || failed ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

watch(() => [props.open, props.agentId], load, { immediate: true })
watch(saving, (pending) => emit('pending-change', pending), { immediate: true })

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
