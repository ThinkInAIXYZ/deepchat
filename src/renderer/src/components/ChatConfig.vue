<script setup lang="ts">
// === Vue Core ===
import { computed, watch, toRef } from 'vue'
import { useI18n } from 'vue-i18n'

// === Components ===
import { Label } from '@shadcn/components/ui/label'
import { Icon } from '@iconify/vue'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import ConfigFieldHeader from './ChatConfig/ConfigFieldHeader.vue'
import ConfigSliderField from './ChatConfig/ConfigSliderField.vue'
import ConfigInputField from './ChatConfig/ConfigInputField.vue'
import ConfigSelectField from './ChatConfig/ConfigSelectField.vue'
import ConfigSwitchField from './ChatConfig/ConfigSwitchField.vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useModelCapabilities } from '@/composables/useModelCapabilities'
import { useThinkingBudget } from '@/composables/useThinkingBudget'
import { useSearchConfig } from '@/composables/useSearchConfig'
import { useModelTypeDetection } from '@/composables/useModelTypeDetection'
import { useChatConfigFields } from '@/composables/useChatConfigFields'
import { useAcpMode } from '@/components/chat-input/composables/useAcpMode'
import { useAcpSessionModel } from '@/components/chat-input/composables/useAcpSessionModel'
import { useAcpWorkdir } from '@/components/chat-input/composables/useAcpWorkdir'

// === Stores ===
import { useLanguageStore } from '@/stores/language'
import { useChatStore } from '@/stores/chat'

// === Props & Emits ===
const props = defineProps<{
  contextLengthLimit?: number
  maxTokensLimit?: number
  temperature: number
  contextLength: number
  maxTokens: number
  artifacts: number
  thinkingBudget?: number
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  modelId?: string
  providerId?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  modelType?: 'chat' | 'imageGeneration' | 'embedding' | 'rerank'
}>()

const systemPrompt = defineModel<string>('systemPrompt')

const emit = defineEmits<{
  'update:temperature': [value: number]
  'update:contextLength': [value: number]
  'update:maxTokens': [value: number]
  'update:thinkingBudget': [value: number | undefined]
  'update:enableSearch': [value: boolean | undefined]
  'update:forcedSearch': [value: boolean | undefined]
  'update:searchStrategy': [value: 'turbo' | 'max' | undefined]
  'update:reasoningEffort': [value: 'minimal' | 'low' | 'medium' | 'high']
  'update:verbosity': [value: 'low' | 'medium' | 'high']
}>()

// === Stores ===
const { t } = useI18n()
const langStore = useLanguageStore()
const chatStore = useChatStore()
const configPresenter = usePresenter('configPresenter')

// === Composable Integrations ===

// Model type detection
const modelTypeDetection = useModelTypeDetection({
  modelId: toRef(props, 'modelId'),
  providerId: toRef(props, 'providerId'),
  modelType: toRef(props, 'modelType')
})

// Model capabilities
const capabilities = useModelCapabilities({
  providerId: toRef(props, 'providerId'),
  modelId: toRef(props, 'modelId'),
  configPresenter
})

// Thinking budget
const thinkingBudget = useThinkingBudget({
  thinkingBudget: toRef(props, 'thinkingBudget'),
  budgetRange: capabilities.budgetRange,
  modelReasoning: modelTypeDetection.modelReasoning,
  supportsReasoning: capabilities.supportsReasoning,
  isGeminiProvider: modelTypeDetection.isGeminiProvider
})

// Search config
const searchConfig = useSearchConfig({
  supportsSearch: capabilities.supportsSearch,
  searchDefaults: capabilities.searchDefaults
})

// === Utility Functions ===

/**
 * Format token size for display (K, M notation)
 */
const formatSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)}M`
  } else if (size >= 1024) {
    return `${(size / 1024).toFixed(1)}K`
  }
  return `${size}`
}

// === Field Configurations ===
const { sliderFields, inputFields, selectFields } = useChatConfigFields({
  // Props
  temperature: toRef(props, 'temperature'),
  contextLength: toRef(props, 'contextLength'),
  maxTokens: toRef(props, 'maxTokens'),
  contextLengthLimit: toRef(props, 'contextLengthLimit'),
  maxTokensLimit: toRef(props, 'maxTokensLimit'),
  thinkingBudget: toRef(props, 'thinkingBudget'),
  reasoningEffort: toRef(props, 'reasoningEffort'),
  verbosity: toRef(props, 'verbosity'),
  enableSearch: toRef(props, 'enableSearch'),
  forcedSearch: toRef(props, 'forcedSearch'),
  searchStrategy: toRef(props, 'searchStrategy'),
  providerId: toRef(props, 'providerId'),

  // Composables
  isGPT5Model: modelTypeDetection.isGPT5Model,
  isImageGenerationModel: modelTypeDetection.isImageGenerationModel,
  showThinkingBudget: thinkingBudget.showThinkingBudget,
  thinkingBudgetError: thinkingBudget.validationError,
  budgetRange: capabilities.budgetRange,
  showSearchConfig: searchConfig.showSearchConfig,
  hasForcedSearchOption: searchConfig.hasForcedSearchOption,
  hasSearchStrategyOption: searchConfig.hasSearchStrategyOption,

  // Utils
  formatSize,

  // Emits
  emit
})

// === Local State & Computed ===
const acpSessionEligibleAgents = new Set(['claude-code-acp', 'codex-acp'])

const acpSessionTargetModel = computed(() => {
  if (!props.providerId) return null
  return { id: props.modelId, providerId: props.providerId }
})

const conversationId = computed(() => chatStore.activeThread?.id ?? null)

const acpWorkdir = useAcpWorkdir({
  activeModel: acpSessionTargetModel,
  conversationId
})

const acpSessionModel = useAcpSessionModel({
  activeModel: acpSessionTargetModel,
  conversationId,
  workdir: acpWorkdir.workdir
})

const acpMode = useAcpMode({
  activeModel: acpSessionTargetModel,
  conversationId,
  workdir: acpWorkdir.workdir
})

const showAcpSessionConfig = computed(() => {
  const modelId = props.modelId ?? ''
  return props.providerId === 'acp' && acpSessionEligibleAgents.has(modelId)
})

const acpSessionModelOptions = computed(() =>
  acpSessionModel.availableModels.value.map((model) => ({
    value: model.id,
    label: model.name || model.id
  }))
)

const acpSessionModeOptions = computed(() =>
  acpMode.availableModes.value.map((mode) => ({
    value: mode.id,
    label: mode.name || mode.id
  }))
)

const acpSessionModelValue = computed(() =>
  acpSessionModel.hasModels.value ? acpSessionModel.currentModelId.value || undefined : undefined
)

const acpSessionModeValue = computed(() =>
  acpMode.hasAgentModes.value ? acpMode.currentMode.value || undefined : undefined
)

const acpSessionModelPlaceholder = computed(() =>
  acpSessionModel.hasModels.value
    ? t('settings.model.acpSession.model.placeholder')
    : t('settings.model.acpSession.model.empty')
)

const acpSessionModePlaceholder = computed(() =>
  acpMode.hasAgentModes.value
    ? t('settings.model.acpSession.mode.placeholder')
    : t('settings.model.acpSession.mode.empty')
)

const acpSessionModelHint = computed(() => acpSessionModel.currentModelInfo.value?.description)
const acpSessionModeHint = computed(() => acpMode.currentModeInfo.value?.description)

const acpSessionModelDisabled = computed(
  () => acpSessionModel.loading.value || !acpSessionModel.hasModels.value
)
const acpSessionModeDisabled = computed(() => acpMode.loading.value || !acpMode.hasAgentModes.value)

// Clear system prompt when switching to image generation model
watch(
  () => props.modelType,
  (newType) => {
    if (newType === 'imageGeneration' && systemPrompt.value) {
      systemPrompt.value = ''
    }
  }
)

// Model type icon mapping
const modelTypeIcon = computed(() => {
  const icons = {
    chat: 'lucide:message-circle',
    imageGeneration: 'lucide:image',
    embedding: 'lucide:layers',
    rerank: 'lucide:arrow-up-down'
  }
  return icons[props.modelType || 'chat']
})
</script>

<template>
  <div class="pt-2 pb-6 px-2" :dir="langStore.dir">
    <!-- Header -->
    <div class="flex items-center gap-2 px-2 mb-2">
      <h2 class="text-xs text-muted-foreground">{{ t('settings.model.title') }}</h2>
      <Icon :icon="modelTypeIcon" class="w-3 h-3 text-muted-foreground" />
    </div>

    <div class="space-y-6">
      <!-- System Prompt (hidden for image generation models) -->
      <div v-if="!modelTypeDetection.isImageGenerationModel.value" class="space-y-2 px-2">
        <div class="flex items-center space-x-2 py-1.5">
          <Icon icon="lucide:terminal" class="w-4 h-4 text-muted-foreground" />
          <Label class="text-xs font-medium">{{ t('settings.model.systemPrompt.label') }}</Label>
          <TooltipProvider :ignoreNonKeyboardFocus="true" :delayDuration="200">
            <Tooltip>
              <TooltipTrigger>
                <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('settings.model.systemPrompt.description') }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Textarea
          v-model="systemPrompt"
          :placeholder="t('settings.model.systemPrompt.placeholder')"
        />
      </div>

      <!-- Slider Fields (Temperature, Context Length, Response Length) -->
      <ConfigSliderField
        v-for="field in sliderFields"
        :key="field.key"
        :model-value="field.getValue()"
        :icon="field.icon"
        :label="field.label"
        :description="field.description || ''"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :formatter="field.formatter"
        @update:model-value="field.setValue"
      />

      <!-- Input Fields (Thinking Budget) -->
      <ConfigInputField
        v-for="field in inputFields"
        :key="field.key"
        :model-value="field.getValue()"
        :icon="field.icon"
        :label="field.label"
        :description="field.description"
        :type="field.inputType"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :placeholder="field.placeholder"
        :error="field.error?.()"
        :hint="field.hint?.()"
        @update:model-value="field.setValue"
      />

      <!-- Search Configuration (nested switches and select) -->
      <div v-if="searchConfig.showSearchConfig.value" class="space-y-4 px-2">
        <ConfigFieldHeader
          icon="lucide:search"
          :label="t('settings.model.modelConfig.enableSearch.label')"
          :description="t('settings.model.modelConfig.enableSearch.description')"
        />

        <div class="space-y-3 pl-4 border-l-2 border-muted">
          <!-- Enable Search Toggle -->
          <ConfigSwitchField
            :model-value="props.enableSearch ?? false"
            :label="t('settings.model.modelConfig.enableSearch.label')"
            @update:model-value="(val) => emit('update:enableSearch', val)"
          />

          <!-- Forced Search -->
          <ConfigSwitchField
            v-if="props.enableSearch && searchConfig.hasForcedSearchOption.value"
            :model-value="props.forcedSearch ?? false"
            :label="t('settings.model.modelConfig.forcedSearch.label')"
            @update:model-value="(val) => emit('update:forcedSearch', val)"
          />

          <!-- Search Strategy (from select fields) -->
          <template v-if="props.enableSearch && searchConfig.hasSearchStrategyOption.value">
            <ConfigSelectField
              v-for="field in selectFields.filter((f) => f.key === 'searchStrategy')"
              :key="field.key"
              :model-value="field.getValue()"
              :icon="field.icon"
              :label="field.label"
              :description="field.description"
              :options="typeof field.options === 'function' ? field.options() : field.options"
              :placeholder="field.placeholder"
              :hint="field.hint"
              @update:model-value="field.setValue"
            />
          </template>
        </div>
      </div>

      <!-- ACP Session Configuration (Claude Code / Codex) -->
      <div v-if="showAcpSessionConfig" class="space-y-4 px-2">
        <ConfigFieldHeader
          icon="lucide:bot"
          :label="t('settings.model.acpSession.title')"
          :description="t('settings.model.acpSession.description')"
        />

        <div class="space-y-3 pl-4 border-l-2 border-muted">
          <ConfigSelectField
            :model-value="acpSessionModelValue"
            icon="lucide:cpu"
            :label="t('settings.model.acpSession.model.label')"
            :description="t('settings.model.acpSession.model.description')"
            :options="acpSessionModelOptions"
            :placeholder="acpSessionModelPlaceholder"
            :hint="acpSessionModelHint"
            :disabled="acpSessionModelDisabled"
            @update:model-value="acpSessionModel.setModel"
          />

          <ConfigSelectField
            :model-value="acpSessionModeValue"
            icon="lucide:shield"
            :label="t('settings.model.acpSession.mode.label')"
            :description="t('settings.model.acpSession.mode.description')"
            :options="acpSessionModeOptions"
            :placeholder="acpSessionModePlaceholder"
            :hint="acpSessionModeHint"
            :disabled="acpSessionModeDisabled"
            @update:model-value="acpMode.setMode"
          />
        </div>
      </div>

      <!-- Select Fields (Reasoning Effort, Verbosity) -->
      <ConfigSelectField
        v-for="field in selectFields.filter((f) => f.key !== 'searchStrategy')"
        :key="field.key"
        :model-value="field.getValue()"
        :icon="field.icon"
        :label="field.label"
        :description="field.description"
        :options="typeof field.options === 'function' ? field.options() : field.options"
        :placeholder="field.placeholder"
        :hint="field.hint"
        @update:model-value="field.setValue"
      />
    </div>
  </div>
</template>
