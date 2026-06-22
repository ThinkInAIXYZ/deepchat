<template>
  <div class="w-full">
    <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <template v-else>
      <div
        v-if="isRoot"
        class="mb-4 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"
      >
        {{ t('settings.memory.config.rootHint') }}
      </div>

      <div class="space-y-4">
        <section class="space-y-3 rounded-2xl border border-border p-5">
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
              @update:model-value="setMemoryEnabled"
            />
          </div>
        </section>

        <template v-if="form.memoryEnabled">
          <section class="space-y-4 rounded-2xl border border-border p-5">
            <div class="space-y-1.5">
              <div class="text-[11px] font-medium text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryEmbeddingModel') }}
              </div>
              <Popover v-model:open="embeddingOpen">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs md:w-[320px]"
                  >
                    <div class="flex min-w-0 items-center gap-1.5">
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
                    </div>
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
                      @click="form.memoryEmbedding = null"
                    >
                      {{ t('common.clear') }}
                    </Button>
                  </div>
                  <ModelSelect
                    :exclude-providers="['acp']"
                    :respect-chat-mode="false"
                    :type="[ModelType.Embedding]"
                    @update:model="
                      (model, providerId) => {
                        form.memoryEmbedding = { providerId, modelId: model.id }
                        embeddingOpen = false
                      }
                    "
                  />
                </PopoverContent>
              </Popover>
              <p class="text-[11px] text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryEmbeddingHint') }}
              </p>
            </div>

            <div class="rounded-xl border border-border/70">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                :aria-expanded="advancedOpen"
                @click="advancedOpen = !advancedOpen"
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
              </button>

              <div v-if="advancedOpen" class="space-y-4 border-t border-border/70 p-3">
                <div class="space-y-1.5">
                  <div class="text-[11px] font-medium text-muted-foreground">
                    {{ t('settings.memory.config.extractionModel') }}
                  </div>
                  <Popover v-model:open="extractionOpen">
                    <PopoverTrigger as-child>
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs md:w-[320px]"
                      >
                        <div class="flex min-w-0 items-center gap-1.5">
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
                        </div>
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
                          @click="form.memoryExtractionModel = null"
                        >
                          {{ t('common.clear') }}
                        </Button>
                      </div>
                      <ModelSelect
                        :exclude-providers="['acp']"
                        :respect-chat-mode="false"
                        @update:model="
                          (model, providerId) => {
                            form.memoryExtractionModel = { providerId, modelId: model.id }
                            extractionOpen = false
                          }
                        "
                      />
                    </PopoverContent>
                  </Popover>
                  <p class="text-[11px] text-muted-foreground">
                    {{ t('settings.memory.config.extractionModelHint') }}
                  </p>
                </div>

                <div class="space-y-1.5">
                  <div class="text-[11px] font-medium text-muted-foreground">
                    {{ t('settings.memory.config.injectionBudget') }}
                  </div>
                  <Input
                    v-model="form.injectionBudget"
                    inputmode="numeric"
                    class="h-8 w-full rounded-lg text-xs md:w-[200px]"
                    :placeholder="String(resolvedBudget)"
                  />
                  <p class="text-[11px] text-muted-foreground">
                    {{
                      t('settings.memory.config.injectionBudgetHint', { default: DEFAULTS.budget })
                    }}
                    {{ t('settings.memory.config.inheritedHint') }}
                  </p>
                </div>

                <section class="space-y-3 rounded-xl border border-border p-4">
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
                      @update:model-value="toggleRetrievalOverride"
                    />
                  </div>

                  <div
                    class="grid gap-3 sm:grid-cols-2"
                    :class="form.overrideRetrieval ? '' : 'pointer-events-none opacity-50'"
                  >
                    <label class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t('settings.memory.config.topK') }}
                      </span>
                      <Input
                        v-model="form.retrieval.topK"
                        inputmode="numeric"
                        :disabled="!form.overrideRetrieval"
                        class="h-8 rounded-lg text-xs"
                        :placeholder="String(DEFAULTS.topK)"
                      />
                      <span class="text-[10px] text-muted-foreground">
                        {{ t('settings.memory.config.topKHint', { default: DEFAULTS.topK }) }}
                      </span>
                    </label>
                    <label class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t('settings.memory.config.rrfK') }}
                      </span>
                      <Input
                        v-model="form.retrieval.rrfK"
                        inputmode="numeric"
                        :disabled="!form.overrideRetrieval"
                        class="h-8 rounded-lg text-xs"
                        :placeholder="String(DEFAULTS.rrfK)"
                      />
                      <span class="text-[10px] text-muted-foreground">
                        {{ t('settings.memory.config.rrfKHint', { default: DEFAULTS.rrfK }) }}
                      </span>
                    </label>
                    <label class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t('settings.memory.config.similarityThreshold') }}
                      </span>
                      <Input
                        v-model="form.retrieval.similarityThreshold"
                        inputmode="decimal"
                        :disabled="!form.overrideRetrieval"
                        class="h-8 rounded-lg text-xs"
                        :placeholder="String(DEFAULTS.similarityThreshold)"
                      />
                      <span class="text-[10px] text-muted-foreground">
                        {{
                          t('settings.memory.config.similarityThresholdHint', {
                            default: DEFAULTS.similarityThreshold
                          })
                        }}
                      </span>
                    </label>
                    <div class="hidden sm:block" />
                    <label class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t('settings.memory.config.weightSimilarity') }}
                      </span>
                      <Input
                        v-model="form.retrieval.weightSimilarity"
                        inputmode="decimal"
                        :disabled="!form.overrideRetrieval"
                        class="h-8 rounded-lg text-xs"
                        :placeholder="String(DEFAULTS.weights.similarity)"
                      />
                      <span class="text-[10px] text-muted-foreground">
                        {{
                          t('settings.memory.config.weightHint', {
                            default: DEFAULTS.weights.similarity
                          })
                        }}
                      </span>
                    </label>
                    <label class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t('settings.memory.config.weightRecency') }}
                      </span>
                      <Input
                        v-model="form.retrieval.weightRecency"
                        inputmode="decimal"
                        :disabled="!form.overrideRetrieval"
                        class="h-8 rounded-lg text-xs"
                        :placeholder="String(DEFAULTS.weights.recency)"
                      />
                      <span class="text-[10px] text-muted-foreground">
                        {{
                          t('settings.memory.config.weightHint', {
                            default: DEFAULTS.weights.recency
                          })
                        }}
                      </span>
                    </label>
                    <label class="space-y-1">
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ t('settings.memory.config.weightImportance') }}
                      </span>
                      <Input
                        v-model="form.retrieval.weightImportance"
                        inputmode="decimal"
                        :disabled="!form.overrideRetrieval"
                        class="h-8 rounded-lg text-xs"
                        :placeholder="String(DEFAULTS.weights.importance)"
                      />
                      <span class="text-[10px] text-muted-foreground">
                        {{
                          t('settings.memory.config.weightHint', {
                            default: DEFAULTS.weights.importance
                          })
                        }}
                      </span>
                    </label>
                  </div>
                </section>
              </div>
            </div>
          </section>

          <section class="space-y-2 rounded-2xl border border-border p-5">
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
                @update:model-value="setPersonaEvolution"
              />
            </div>
            <p class="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {{ t('settings.deepchatAgents.personaEvolutionWarning') }}
            </p>
          </section>
        </template>
      </div>

      <div class="mt-5 flex items-center justify-end gap-3">
        <span v-if="saveError" class="text-xs text-destructive">{{ saveError }}</span>
        <Button size="sm" :disabled="saving" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Switch } from '@shadcn/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { createConfigClient } from '@api/ConfigClient'
import { useModelStore } from '@/stores/modelStore'
import { ModelType } from '@shared/model'
import type {
  DeepChatAgentConfig,
  DeepChatAgentModelSelection
} from '@shared/types/agent-interface'

const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'

// Display defaults mirror the kernel resolveRetrieval / injection constants. They drive placeholders
// and the fallback when a field is being overridden but parses to an invalid value.
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

const props = defineProps<{ agentId: string }>()
const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const configClient = createConfigClient()
const modelStore = useModelStore()

const loading = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const embeddingOpen = ref(false)
const extractionOpen = ref(false)
const advancedOpen = ref(false)

const originalConfig = ref<DeepChatAgentConfig>({})
const resolvedConfig = ref<DeepChatAgentConfig | null>(null)
const memoryEnabledTouched = ref(false)
const personaEvolutionTouched = ref(false)

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

const isRoot = computed(() => props.agentId === BUILTIN_DEEPCHAT_AGENT_ID)
const resolvedBudget = computed(
  () => resolvedConfig.value?.memoryInjectionTokenBudget ?? DEFAULTS.budget
)

function modelLabel(selection: EditableModel): string {
  if (!selection?.providerId || !selection?.modelId) {
    return t('common.selectModel')
  }
  const providerModels = modelStore.allProviderModels.find(
    (entry) => entry.providerId === selection.providerId
  )
  const matched = providerModels?.models.find((model) => model.id === selection.modelId)
  if (matched) return matched.name || matched.id
  const fallback = modelStore.findModelByIdOrName(selection.modelId)
  return fallback?.model.name || selection.modelId
}

function toEditableModel(selection: DeepChatAgentModelSelection | null | undefined): EditableModel {
  return selection ? { providerId: selection.providerId, modelId: selection.modelId } : null
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

async function load(): Promise<void> {
  if (!props.agentId) return
  loading.value = true
  saveError.value = null
  try {
    const [agents, resolved] = await Promise.all([
      configClient.listAgents(),
      configClient.resolveDeepChatAgentConfig(props.agentId)
    ])
    const config: DeepChatAgentConfig =
      agents.find((agent) => agent.id === props.agentId)?.config ?? {}
    originalConfig.value = config
    resolvedConfig.value = resolved
    // Booleans display their resolved (inherited) value so an agent that inherits the root's
    // memoryEnabled is shown as on; a save only writes them when the user toggles the switch.
    form.memoryEnabled = resolvedConfig.value?.memoryEnabled ?? false
    form.personaEvolutionEnabled = resolvedConfig.value?.personaEvolutionEnabled ?? false
    memoryEnabledTouched.value = false
    personaEvolutionTouched.value = false
    form.memoryEmbedding = toEditableModel(config.memoryEmbedding)
    form.memoryExtractionModel = toEditableModel(config.memoryExtractionModel)
    form.injectionBudget =
      config.memoryInjectionTokenBudget != null ? String(config.memoryInjectionTokenBudget) : ''
    form.overrideRetrieval = config.memoryRetrieval != null
    seedRetrieval(config.memoryRetrieval ?? resolvedConfig.value?.memoryRetrieval ?? undefined)
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

function setMemoryEnabled(value: boolean): void {
  form.memoryEnabled = value
  memoryEnabledTouched.value = true
}

function setPersonaEvolution(value: boolean): void {
  form.personaEvolutionEnabled = value
  personaEvolutionTouched.value = true
}

function toggleRetrievalOverride(value: boolean): void {
  form.overrideRetrieval = value
  if (value && !form.retrieval.topK) {
    seedRetrieval(resolvedConfig.value?.memoryRetrieval)
  }
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

function buildRetrieval(): NonNullable<DeepChatAgentConfig['memoryRetrieval']> {
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

// Shallow merge means an omitted key keeps the prior override; only an explicit null falls back to
// the inherited/default value. So a field that was overridden and is now empty must be sent as null.
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

async function save(): Promise<void> {
  saving.value = true
  saveError.value = null
  try {
    const patch: DeepChatAgentConfig = {}
    // Untouched booleans are omitted so the shallow merge keeps the inherited value; only an
    // explicit toggle writes the override.
    if (memoryEnabledTouched.value) patch.memoryEnabled = form.memoryEnabled
    if (personaEvolutionTouched.value) patch.personaEvolutionEnabled = form.personaEvolutionEnabled
    applyOverride(
      patch,
      'memoryEmbedding',
      form.memoryEmbedding
        ? { providerId: form.memoryEmbedding.providerId, modelId: form.memoryEmbedding.modelId }
        : null
    )
    applyOverride(
      patch,
      'memoryExtractionModel',
      form.memoryExtractionModel
        ? {
            providerId: form.memoryExtractionModel.providerId,
            modelId: form.memoryExtractionModel.modelId
          }
        : null
    )
    const budget = form.injectionBudget.trim()
      ? clampInt(form.injectionBudget, DEFAULTS.budget, LIMITS.budget.min, LIMITS.budget.max)
      : null
    applyOverride(patch, 'memoryInjectionTokenBudget', budget)
    applyOverride(patch, 'memoryRetrieval', form.overrideRetrieval ? buildRetrieval() : null)

    await configClient.updateDeepChatAgent(props.agentId, { config: patch })
    await load()
    emit('saved')
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

watch(() => props.agentId, load, { immediate: true })
</script>
