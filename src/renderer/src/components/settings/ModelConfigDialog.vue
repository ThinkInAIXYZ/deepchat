<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.model.modelConfig.description') }}
        </p>
      </DialogHeader>

      <div class="overflow-y-auto flex-1 pr-2 -mr-2">
        <form @submit.prevent="handleSave" class="space-y-6">
          <!-- 模型名称 -->
          <div class="space-y-2">
            <Label for="modelName">{{ t('settings.model.modelConfig.name.label') }}</Label>
            <Input
              id="modelName"
              v-model="modelNameField"
              type="text"
              :placeholder="t('settings.model.modelConfig.name.placeholder')"
              :disabled="!canEditModelIdentity"
              :class="{ 'border-destructive': errors.modelName }"
            />
            <p class="text-xs text-muted-foreground">
              {{
                canEditModelIdentity
                  ? t('settings.model.modelConfig.name.description')
                  : t('settings.model.modelConfig.name.readonly')
              }}
            </p>
            <p v-if="errors.modelName" class="text-xs text-destructive">
              {{ errors.modelName }}
            </p>
          </div>

          <!-- 模型 ID -->
          <div class="space-y-2">
            <Label for="modelId">{{ t('settings.model.modelConfig.id.label') }}</Label>
            <Input
              id="modelId"
              v-model="modelIdField"
              type="text"
              :placeholder="t('settings.model.modelConfig.id.placeholder')"
              :disabled="!canEditModelIdentity"
              :class="{ 'border-destructive': errors.modelId }"
            />
            <p class="text-xs text-muted-foreground">
              {{
                canEditModelIdentity
                  ? t('settings.model.modelConfig.id.description')
                  : t('settings.model.modelConfig.id.readonly')
              }}
            </p>
            <p v-if="errors.modelId" class="text-xs text-destructive">
              {{ errors.modelId }}
            </p>
          </div>

          <!-- 最大输出长度 -->
          <div class="space-y-2">
            <Label for="maxTokens">{{ t('settings.model.modelConfig.maxTokens.label') }}</Label>
            <Input
              id="maxTokens"
              v-model.number="config.maxTokens"
              type="number"
              :min="1"
              :max="1000000"
              :placeholder="t('settings.model.modelConfig.maxTokens.label')"
              :class="{ 'border-destructive': errors.maxTokens }"
            />
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.maxTokens.description') }}
            </p>
            <p v-if="errors.maxTokens" class="text-xs text-destructive">
              {{ errors.maxTokens }}
            </p>
          </div>

          <!-- 上下文长度 -->
          <div class="space-y-2">
            <Label for="contextLength">{{
              t('settings.model.modelConfig.contextLength.label')
            }}</Label>
            <Input
              id="contextLength"
              v-model.number="config.contextLength"
              type="number"
              :min="1"
              :max="10000000"
              :placeholder="t('settings.model.modelConfig.contextLength.label')"
              :class="{ 'border-destructive': errors.contextLength }"
            />
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.contextLength.description') }}
            </p>
            <p v-if="errors.contextLength" class="text-xs text-destructive">
              {{ errors.contextLength }}
            </p>
          </div>

          <!-- 温度 (支持推理努力程度的模型不显示) -->
          <div v-if="!supportsReasoningEffort" class="space-y-2">
            <Label for="temperature">{{ t('settings.model.modelConfig.temperature.label') }}</Label>
            <Input
              id="temperature"
              v-model.number="config.temperature"
              type="number"
              step="0.1"
              :min="0"
              :max="2"
              :placeholder="t('settings.model.modelConfig.temperature.label')"
              :class="{ 'border-destructive': errors.temperature }"
            />
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.temperature.description') }}
            </p>
            <p v-if="errors.temperature" class="text-xs text-destructive">
              {{ errors.temperature }}
            </p>
          </div>

          <!-- 模型类型 -->
          <div class="space-y-2">
            <Label for="type">{{ t('settings.model.modelConfig.type.label') }}</Label>
            <Select v-model="config.type">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.model.modelConfig.type.label')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">
                  {{ t('settings.model.modelConfig.type.options.chat') }}
                </SelectItem>
                <SelectItem value="embedding">
                  {{ t('settings.model.modelConfig.type.options.embedding') }}
                </SelectItem>
                <SelectItem value="rerank">
                  {{ t('settings.model.modelConfig.type.options.rerank') }}
                </SelectItem>
                <SelectItem value="imageGeneration">
                  {{ t('settings.model.modelConfig.type.options.imageGeneration') }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.type.description') }}
            </p>
          </div>

          <div v-if="showEndpointTypeSelector" class="space-y-2">
            <Label for="endpointType">{{
              t('settings.model.modelConfig.endpointType.label')
            }}</Label>
            <Select v-model="config.endpointType">
              <SelectTrigger :class="{ 'border-destructive': errors.endpointType }">
                <SelectValue
                  :placeholder="t('settings.model.modelConfig.endpointType.placeholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="endpointType in availableEndpointTypes"
                  :key="endpointType"
                  :value="endpointType"
                >
                  {{ t(`settings.model.modelConfig.endpointType.options.${endpointType}`) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.endpointType.description') }}
            </p>
            <p v-if="errors.endpointType" class="text-xs text-destructive">
              {{ errors.endpointType }}
            </p>
          </div>

          <!-- API 端点（仅 OpenAI 兼容 provider 显示） -->
          <div v-if="showApiEndpointSelector" class="space-y-2">
            <Label for="apiEndpoint">{{ t('settings.model.modelConfig.apiEndpoint.label') }}</Label>
            <Select v-model="config.apiEndpoint">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.model.modelConfig.apiEndpoint.label')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">
                  {{ t('settings.model.modelConfig.apiEndpoint.options.chat') }}
                </SelectItem>
                <SelectItem value="image">
                  {{ t('settings.model.modelConfig.apiEndpoint.options.image') }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.apiEndpoint.description') }}
            </p>
          </div>

          <!-- 视觉能力 -->
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>{{ t('settings.model.modelConfig.vision.label') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.model.modelConfig.vision.description') }}
              </p>
            </div>
            <Switch
              :model-value="config.vision"
              @update:model-value="(value) => (config.vision = value)"
            />
          </div>

          <!-- 函数调用 -->
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>{{ t('settings.model.modelConfig.functionCall.label') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.model.modelConfig.functionCall.description') }}
              </p>
              <!-- DeepSeek-V3.1 互斥提示 -->
              <p v-if="isDeepSeekV31Model" class="text-xs text-orange-600">
                {{ t('dialog.mutualExclusive.warningText.functionCall') }}
              </p>
            </div>
            <Switch
              :model-value="config.functionCall"
              @update:model-value="handleFunctionCallToggle"
            />
          </div>

          <!-- 推理能力 -->
          <div v-if="showReasoningToggle" class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>{{ t('settings.model.modelConfig.reasoning.label') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.model.modelConfig.reasoning.description') }}
              </p>
              <!-- DeepSeek-V3.1 互斥提示 -->
              <p v-if="isDeepSeekV31Model" class="text-xs text-orange-600">
                {{ t('dialog.mutualExclusive.warningText.reasoning') }}
              </p>
            </div>
            <Switch :model-value="config.reasoning" @update:model-value="handleReasoningToggle" />
          </div>

          <div v-if="showInterleavedThinking" class="flex items-center justify-between gap-4">
            <div class="space-y-0.5">
              <Label>{{ t('settings.model.modelConfig.interleavedThinking.label') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.model.modelConfig.interleavedThinking.description') }}
              </p>
            </div>
            <Switch
              data-setting-control="interleavedThinking-toggle"
              :model-value="config.forceInterleavedThinkingCompat === true"
              @update:model-value="
                (value) => (config.forceInterleavedThinkingCompat = Boolean(value))
              "
            />
          </div>

          <!-- 推理努力程度 (支持推理努力程度的模型显示) -->
          <div v-if="supportsReasoningEffort" class="space-y-2">
            <Label for="reasoningEffort">{{
              t('settings.model.modelConfig.reasoningEffort.label')
            }}</Label>
            <Select v-model="config.reasoningEffort">
              <SelectTrigger>
                <SelectValue
                  :placeholder="t('settings.model.modelConfig.reasoningEffort.placeholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in reasoningEffortOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.reasoningEffort.description') }}
            </p>
          </div>

          <!-- 详细程度（存在该参数即显示） -->
          <div v-if="supportsVerbosity" class="space-y-2">
            <Label for="verbosity">{{ t('settings.model.modelConfig.verbosity.label') }}</Label>
            <Select v-model="config.verbosity">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.model.modelConfig.verbosity.placeholder')" />
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
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.verbosity.description') }}
            </p>
          </div>

          <!-- 思考预算（统一基于能力） -->
          <div v-if="showThinkingBudget" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label>{{ t('settings.model.modelConfig.thinkingBudget.label') }}</Label>
              </div>
            </div>

            <!-- 思考预算详细配置 -->
            <div class="space-y-3 pl-4 border-l-2 border-muted">
              <!-- 数值输入 -->
              <div class="space-y-2">
                <Label class="text-sm">{{
                  t('settings.model.modelConfig.thinkingBudget.label')
                }}</Label>
                <Input
                  v-model.number="config.thinkingBudget"
                  type="number"
                  :min="thinkingBudgetRange?.min"
                  :max="thinkingBudgetRange?.max"
                  :step="128"
                  :placeholder="t('settings.model.modelConfig.thinkingBudget.placeholder')"
                  :class="{ 'border-destructive': genericThinkingBudgetError }"
                />
                <p class="text-xs text-muted-foreground">
                  <span v-if="genericThinkingBudgetError" class="text-red-600 font-medium">
                    {{ genericThinkingBudgetError }}
                  </span>
                  <span v-else>
                    {{
                      t('settings.model.modelConfig.thinkingBudget.range', {
                        min: thinkingBudgetRange?.min,
                        max: thinkingBudgetRange?.max
                      })
                    }}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>

      <DialogFooter class="gap-2">
        <Button type="button" variant="outline" @click="handleReset">
          {{ t('settings.model.modelConfig.resetToDefault') }}
        </Button>
        <Button type="button" variant="ghost" @click="$emit('update:open', false)">
          {{ t('settings.model.modelConfig.cancel') }}
        </Button>
        <Button type="button" @click="handleSave" :disabled="!isValid">
          {{ t('settings.model.modelConfig.saveConfig') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 重置确认对话框 -->
  <Dialog :open="showResetConfirm" @update:open="showResetConfirm = $event">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.model.modelConfig.resetConfirm.title') }}</DialogTitle>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.model.modelConfig.resetConfirm.message') }}
        </p>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" @click="showResetConfirm = false">
          {{ t('settings.model.modelConfig.cancel') }}
        </Button>
        <Button variant="destructive" @click="confirmReset">
          {{ t('settings.model.modelConfig.resetConfirm.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- DeepSeek-V3.1 互斥确认对话框 -->
  <AlertDialog :open="showMutualExclusiveAlert" @update:open="showMutualExclusiveAlert = $event">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ getConfirmTitle }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ getConfirmMessage }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="cancelMutualExclusiveToggle">
          {{ t('dialog.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction @click="confirmMutualExclusiveToggle">
          {{ t('dialog.mutualExclusive.confirmEnable') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  ApiEndpointType,
  ModelType,
  NEW_API_ENDPOINT_TYPES,
  isNewApiEndpointType,
  type NewApiEndpointType
} from '@shared/model'
import type { ModelConfig } from '@shared/presenter'
import {
  DEFAULT_REASONING_EFFORT_OPTIONS as FALLBACK_REASONING_EFFORT_OPTIONS,
  isReasoningEffort,
  isVerbosity,
  type ReasoningEffort,
  type ReasoningPortrait
} from '@shared/types/model-db'
import {
  DEFAULT_MODEL_CONTEXT_LENGTH,
  DEFAULT_MODEL_FUNCTION_CALL,
  DEFAULT_MODEL_MAX_TOKENS,
  DEFAULT_MODEL_VISION
} from '@shared/modelConfigDefaults'
import { useModelConfigStore } from '@/stores/modelConfigStore'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'
import { usePresenter } from '@/composables/usePresenter'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'

interface Props {
  open: boolean
  modelId: string
  modelName: string
  providerId: string
  mode?: 'create' | 'edit'
  isCustomModel?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'edit',
  isCustomModel: false
})

const emit = defineEmits<{
  'update:open': [boolean]
  saved: []
}>()

const { t } = useI18n()
const modelConfigStore = useModelConfigStore()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const { customModels, allProviderModels } = storeToRefs(modelStore)
const configPresenter = usePresenter('configPresenter')
const providerIdLower = computed(() => props.providerId?.toLowerCase() || '')
const currentProvider = computed(() =>
  providerStore.providers.find((provider) => provider.id === props.providerId)
)

const isOpenAICompatibleProvider = computed(() => {
  const EXCLUDED_PROVIDERS = [
    'anthropic',
    'gemini',
    'vertex',
    'aws-bedrock',
    'github-copilot',
    'ollama',
    'acp',
    'voiceai'
  ]
  return !EXCLUDED_PROVIDERS.some((excluded) => providerIdLower.value.includes(excluded))
})

const isResponsesProvider = computed(() => {
  if (providerIdLower.value === 'openai' || providerIdLower.value === 'openai-responses') {
    return true
  }

  const apiType = currentProvider.value?.apiType?.toLowerCase()
  return apiType === 'openai' || apiType === 'openai-responses'
})

const isNewApiProvider = computed(() => {
  if (providerIdLower.value === 'new-api') {
    return true
  }

  return currentProvider.value?.apiType?.toLowerCase() === 'new-api'
})

const showApiEndpointSelector = computed(
  () => !isNewApiProvider.value && !isResponsesProvider.value && isOpenAICompatibleProvider.value
)
const showEndpointTypeSelector = computed(() => isNewApiProvider.value)

const createDefaultConfig = (): ModelConfig => ({
  maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
  temperature: 0.7,
  vision: DEFAULT_MODEL_VISION,
  functionCall: DEFAULT_MODEL_FUNCTION_CALL,
  reasoning: false,
  forceInterleavedThinkingCompat: undefined,
  type: ModelType.Chat,
  apiEndpoint: ApiEndpointType.Chat,
  endpointType: undefined,
  reasoningEffort: 'medium',
  verbosity: 'medium'
})

const DEFAULT_VERBOSITY_OPTIONS: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']

// 配置数据
const config = ref<ModelConfig>(createDefaultConfig())
const modelNameField = ref(props.modelName ?? '')
const modelIdField = ref(props.modelId ?? '')
const originalModelId = ref(props.modelId ?? '')

const isCreateMode = computed(() => props.mode === 'create')
const identityDisplayName = computed(() => modelNameField.value || props.modelName || '')
const dialogTitle = computed(() =>
  isCreateMode.value
    ? t('settings.model.modelConfig.createTitle')
    : t('settings.model.modelConfig.editTitle', { name: identityDisplayName.value })
)
const canEditModelIdentity = computed(() => isCreateMode.value || props.isCustomModel === true)
const shouldValidateIdentity = computed(() => isCreateMode.value || props.isCustomModel === true)

// 重置确认对话框
const showResetConfirm = ref(false)

// DeepSeek-V3.1 互斥确认对话框
const showMutualExclusiveAlert = ref(false)
const mutualExclusiveAction = ref<{
  from: 'reasoning' | 'functionCall'
  to: 'reasoning' | 'functionCall'
} | null>(null)

// 错误信息
const errors = ref<Record<string, string>>({})
const capabilityReasoningPortrait = ref<ReasoningPortrait | null>(null)

const getReasoningEffortOptions = (
  portrait: ReasoningPortrait | null | undefined
): ReasoningEffort[] => {
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
  if (portrait.mode === 'mixed' || !isReasoningEffort(portrait?.effort)) {
    return []
  }

  return FALLBACK_REASONING_EFFORT_OPTIONS.includes(portrait.effort)
    ? [...FALLBACK_REASONING_EFFORT_OPTIONS]
    : [portrait.effort]
}

const getVerbosityOptions = (
  portrait: ReasoningPortrait | null | undefined
): Array<'low' | 'medium' | 'high'> => {
  const options = portrait?.verbosityOptions?.filter(isVerbosity)
  if (options && options.length > 0) {
    return options
  }
  return isVerbosity(portrait?.verbosity) ? [...DEFAULT_VERBOSITY_OPTIONS] : []
}

const hasReasoningEffortSupport = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getReasoningEffortOptions(portrait).length > 0

const hasVerbositySupport = (portrait: ReasoningPortrait | null | undefined): boolean =>
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

const normalizeReasoningEffortValue = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): ReasoningEffort | undefined => {
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

const normalizeVerbosityValue = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): 'low' | 'medium' | 'high' | undefined => {
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

const normalizeThinkingBudgetValue = (
  portrait: ReasoningPortrait | null | undefined,
  value: number,
  min?: number,
  max?: number
): number => {
  const roundedValue = Math.round(value)
  if (isThinkingBudgetSentinel(portrait, roundedValue)) {
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

const isThinkingBudgetSentinel = (
  portrait: ReasoningPortrait | null | undefined,
  value: number
): boolean => {
  const roundedValue = Math.round(value)
  const sentinelValues = new Set<number>()

  if (typeof portrait?.budget?.default === 'number')
    sentinelValues.add(Math.round(portrait.budget.default))
  if (typeof portrait?.budget?.auto === 'number')
    sentinelValues.add(Math.round(portrait.budget.auto))
  if (typeof portrait?.budget?.off === 'number') sentinelValues.add(Math.round(portrait.budget.off))

  return sentinelValues.has(roundedValue)
}

const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityBudgetRange = ref<{ min?: number; max?: number; default?: number } | null>(null)
const capabilitySupportsEffort = ref<boolean | null>(null)
const capabilityEffortDefault = ref<ReasoningEffort | undefined>(undefined)
const capabilitySupportsVerbosity = ref<boolean | null>(null)
const capabilityVerbosityDefault = ref<'low' | 'medium' | 'high' | undefined>(undefined)

const fetchCapabilities = async () => {
  if (!props.providerId || !props.modelId) {
    capabilityReasoningPortrait.value = null
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilityEffortDefault.value = undefined
    capabilitySupportsVerbosity.value = null
    capabilityVerbosityDefault.value = undefined
    return
  }
  try {
    const portrait =
      (await configPresenter.getReasoningPortrait?.(props.providerId, props.modelId)) ?? null
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
    capabilitySupportsEffort.value = hasReasoningEffortSupport(portrait)
    capabilityEffortDefault.value = normalizeReasoningEffortValue(portrait, portrait?.effort)
    capabilitySupportsVerbosity.value = hasVerbositySupport(portrait)
    capabilityVerbosityDefault.value = normalizeVerbosityValue(portrait, portrait?.verbosity)
  } catch {
    capabilityReasoningPortrait.value = null
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsEffort.value = null
    capabilityEffortDefault.value = undefined
    capabilitySupportsVerbosity.value = null
    capabilityVerbosityDefault.value = undefined
  }
}

const providerCustomModelList = computed(() => {
  if (!props.providerId) return []
  return customModels.value.find((entry) => entry.providerId === props.providerId)?.models ?? []
})

const providerStandardModelList = computed(() => {
  if (!props.providerId) return []
  return (
    allProviderModels.value.find((entry) => entry.providerId === props.providerId)?.models ?? []
  )
})

const currentModelLookupId = computed(() =>
  (isCreateMode.value ? modelIdField.value : props.modelId || modelIdField.value).trim()
)

const providerModelMeta = computed(() => {
  const targetModelId = currentModelLookupId.value
  if (!targetModelId) return null

  return (
    providerStandardModelList.value.find((model) => model.id === targetModelId) ??
    providerCustomModelList.value.find((model) => model.id === targetModelId) ??
    null
  )
})

const availableEndpointTypes = computed<NewApiEndpointType[]>(() => {
  const supportedEndpointTypes = providerModelMeta.value?.supportedEndpointTypes
  if (Array.isArray(supportedEndpointTypes) && supportedEndpointTypes.length > 0) {
    const normalizedEndpointTypes = supportedEndpointTypes.filter(isNewApiEndpointType)
    if (normalizedEndpointTypes.length > 0) {
      return normalizedEndpointTypes
    }
  }

  return [...NEW_API_ENDPOINT_TYPES]
})

const currentCustomModel = computed(() => {
  if (!props.providerId || !props.modelId) return null
  return providerCustomModelList.value.find((model) => model.id === props.modelId) ?? null
})

const hasModelIdConflict = (modelId: string, excludeId?: string) => {
  if (!modelId) return false
  const normalized = modelId.trim().toLowerCase()
  if (!normalized) return false
  const normalizedExcludeId = excludeId?.trim().toLowerCase()
  const models = [...providerStandardModelList.value, ...providerCustomModelList.value]
  return models.some((model) => {
    if (!model.id) return false
    const currentId = model.id.toLowerCase()
    if (normalizedExcludeId && currentId === normalizedExcludeId) return false
    return currentId === normalized
  })
}

const buildCustomModelPayload = (id: string, name: string, enabled?: boolean) => ({
  id,
  name,
  enabled: enabled ?? true,
  contextLength: config.value.contextLength ?? DEFAULT_MODEL_CONTEXT_LENGTH,
  maxTokens: config.value.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
  vision: config.value.vision ?? DEFAULT_MODEL_VISION,
  functionCall: config.value.functionCall ?? DEFAULT_MODEL_FUNCTION_CALL,
  reasoning: config.value.reasoning ?? false,
  type: config.value.type ?? ModelType.Chat,
  endpointType: config.value.endpointType
})

const syncNewApiDerivedFields = () => {
  if (!showEndpointTypeSelector.value) {
    return
  }

  if (!isNewApiEndpointType(config.value.endpointType)) {
    config.value.endpointType =
      providerModelMeta.value?.endpointType ??
      providerModelMeta.value?.supportedEndpointTypes?.[0] ??
      availableEndpointTypes.value[0]
  }

  if (config.value.endpointType === 'image-generation') {
    config.value.apiEndpoint = ApiEndpointType.Image
    config.value.type = ModelType.ImageGeneration
    return
  }

  config.value.apiEndpoint = ApiEndpointType.Chat

  if (config.value.type === ModelType.ImageGeneration) {
    const providerModelType = providerModelMeta.value?.type
    config.value.type =
      providerModelType && providerModelType !== ModelType.ImageGeneration
        ? providerModelType
        : ModelType.Chat
  }
}

const initializeIdentityFields = () => {
  if (isCreateMode.value) {
    modelNameField.value = ''
    modelIdField.value = ''
    originalModelId.value = ''
    return
  }

  modelNameField.value = props.modelName ?? ''
  modelIdField.value = props.modelId ?? ''
  originalModelId.value = props.modelId ?? ''
}

// 加载模型配置
const loadConfig = async () => {
  if (!props.providerId) return

  initializeIdentityFields()

  if (isCreateMode.value) {
    config.value = createDefaultConfig()
    syncNewApiDerivedFields()
    await fetchCapabilities()
    return
  }

  if (!props.modelId) return

  try {
    const modelConfig = await modelConfigStore.getModelConfig(props.modelId, props.providerId)
    config.value = { ...modelConfig }

    if (showEndpointTypeSelector.value && !isNewApiEndpointType(config.value.endpointType)) {
      config.value.endpointType =
        providerModelMeta.value?.endpointType ??
        providerModelMeta.value?.supportedEndpointTypes?.[0] ??
        availableEndpointTypes.value[0]
    }

    if (showApiEndpointSelector.value && !config.value.apiEndpoint) {
      config.value.apiEndpoint = ApiEndpointType.Chat
    }
  } catch (error) {
    console.error('Failed to load model config:', error)
    config.value = createDefaultConfig()
  }

  await fetchCapabilities()

  if (
    config.value.forceInterleavedThinkingCompat === undefined &&
    capabilityReasoningPortrait.value?.interleaved === true
  ) {
    config.value.forceInterleavedThinkingCompat = true
  }

  if (config.value.isUserDefined !== true) {
    const normalizedEffort = normalizeReasoningEffortValue(
      capabilityReasoningPortrait.value,
      config.value.reasoningEffort ?? capabilityEffortDefault.value
    )
    if (supportsReasoningEffort.value) {
      config.value.reasoningEffort = normalizedEffort
    }

    const normalizedVerbosity = normalizeVerbosityValue(
      capabilityReasoningPortrait.value,
      config.value.verbosity ?? capabilityVerbosityDefault.value
    )
    if (supportsVerbosity.value) {
      config.value.verbosity = normalizedVerbosity
    }
  }

  if (config.value.thinkingBudget === undefined) {
    const range = capabilityBudgetRange.value
    if (range && typeof range.default === 'number') {
      config.value.thinkingBudget = range.default
    }
  } else {
    config.value.thinkingBudget = normalizeThinkingBudgetValue(
      capabilityReasoningPortrait.value,
      config.value.thinkingBudget,
      capabilityReasoningPortrait.value?.budget?.min,
      capabilityReasoningPortrait.value?.budget?.max
    )
  }

  syncNewApiDerivedFields()
}

// 验证表单
const validateForm = () => {
  errors.value = {}

  if (shouldValidateIdentity.value) {
    const trimmedName = modelNameField.value.trim()
    const trimmedId = modelIdField.value.trim()

    if (!trimmedName) {
      errors.value.modelName = t('settings.model.modelConfig.name.required')
    }

    if (!trimmedId) {
      errors.value.modelId = t('settings.model.modelConfig.id.required')
    } else {
      const excludeId = isCreateMode.value ? undefined : originalModelId.value
      if (
        (isCreateMode.value || trimmedId !== originalModelId.value) &&
        hasModelIdConflict(trimmedId, excludeId)
      ) {
        errors.value.modelId = t('settings.model.modelConfig.id.duplicate')
      }
    }
  }

  // 验证最大输出长度
  if (!config.value.maxTokens || config.value.maxTokens <= 0) {
    errors.value.maxTokens = t('settings.model.modelConfig.validation.maxTokensMin')
  } else if (config.value.maxTokens > 1000000) {
    errors.value.maxTokens = t('settings.model.modelConfig.validation.maxTokensMax')
  }

  // 验证上下文长度
  if (!config.value.contextLength || config.value.contextLength <= 0) {
    errors.value.contextLength = t('settings.model.modelConfig.validation.contextLengthMin')
  } else if (config.value.contextLength > 100_000_000) {
    errors.value.contextLength = t('settings.model.modelConfig.validation.contextLengthMax')
  }

  // 验证温度 (仅对不支持推理努力程度的模型)
  if (!supportsReasoningEffort.value && config.value.temperature !== undefined) {
    if (config.value.temperature < 0) {
      errors.value.temperature = t('settings.model.modelConfig.validation.temperatureMin')
    } else if (config.value.temperature > 2) {
      errors.value.temperature = t('settings.model.modelConfig.validation.temperatureMax')
    }
  }

  if (showEndpointTypeSelector.value && !isNewApiEndpointType(config.value.endpointType)) {
    errors.value.endpointType = t('settings.model.modelConfig.endpointType.required')
  }
}

// 表单是否有效
const isValid = computed(() => {
  validateForm()
  return Object.keys(errors.value).length === 0 && !genericThinkingBudgetError.value
})

// 保存配置
const handleSave = async () => {
  if (!isValid.value || !props.providerId) return

  const trimmedName = modelNameField.value.trim()
  const trimmedId = modelIdField.value.trim()

  try {
    if (isCreateMode.value) {
      await modelStore.addCustomModel(
        props.providerId,
        buildCustomModelPayload(trimmedId, trimmedName, true)
      )
      await modelConfigStore.setModelConfig(trimmedId, props.providerId, config.value)
    } else if (props.isCustomModel) {
      if (!props.modelId) return
      const previousId = originalModelId.value
      const enabledState = currentCustomModel.value?.enabled ?? true

      if (trimmedId !== previousId) {
        if (previousId) {
          try {
            await modelConfigStore.resetModelConfig(previousId, props.providerId)
          } catch (resetError) {
            console.warn('Failed to reset previous model config:', resetError)
          }
          await modelStore.removeCustomModel(props.providerId, previousId)
        }
        await modelStore.addCustomModel(
          props.providerId,
          buildCustomModelPayload(trimmedId, trimmedName, enabledState)
        )
        if (!enabledState) {
          await modelStore.updateModelStatus(props.providerId, trimmedId, false)
        }
      } else {
        await modelStore.updateCustomModel(props.providerId, trimmedId, {
          name: trimmedName,
          contextLength: config.value.contextLength,
          maxTokens: config.value.maxTokens,
          vision: config.value.vision,
          functionCall: config.value.functionCall,
          reasoning: config.value.reasoning,
          type: config.value.type ?? ModelType.Chat,
          endpointType: config.value.endpointType
        })
      }

      await modelConfigStore.setModelConfig(trimmedId, props.providerId, config.value)
    } else {
      if (!props.modelId) return
      await modelConfigStore.setModelConfig(props.modelId, props.providerId, config.value)
    }

    emit('saved')
    emit('update:open', false)
  } catch (error) {
    console.error('Failed to save model config:', error)
  }
}

// 重置配置
const handleReset = () => {
  showResetConfirm.value = true
}

// 确认重置
const confirmReset = async () => {
  try {
    if (isCreateMode.value) {
      config.value = createDefaultConfig()
      modelNameField.value = ''
      modelIdField.value = ''
      showResetConfirm.value = false
      return
    }

    await modelConfigStore.resetModelConfig(props.modelId, props.providerId)
    await loadConfig() // 重新加载默认配置
    showResetConfirm.value = false
    emit('saved')
  } catch (error) {
    console.error('Failed to reset model config:', error)
  }
}

// 监听props变化，重新加载配置
watch(
  () => [props.modelId, props.providerId, props.open],
  () => {
    if (props.open) {
      loadConfig()
    }
  },
  { immediate: true }
)

watch(
  () => [config.value.endpointType, config.value.type, showEndpointTypeSelector.value],
  () => {
    syncNewApiDerivedFields()
  }
)

const supportsVerbosity = computed(() => capabilitySupportsVerbosity.value === true)

const isDeepSeekV31Model = computed(() => {
  const modelId = props.modelId.toLowerCase()
  return modelId.includes('deepseek-v3.1') || modelId.includes('deepseek-v3-1')
})

const supportsReasoningEffort = computed(() =>
  hasReasoningEffortSupport(capabilityReasoningPortrait.value)
)
const reasoningEffortOptions = computed(() =>
  getReasoningEffortOptions(capabilityReasoningPortrait.value).map((value) => ({
    value,
    label: t(`settings.model.modelConfig.reasoningEffort.options.${value}`)
  }))
)
const verbosityOptions = computed(() =>
  getVerbosityOptions(capabilityReasoningPortrait.value).map((value) => ({
    value,
    label: t(`settings.model.modelConfig.verbosity.options.${value}`)
  }))
)

const showThinkingBudget = computed(() => {
  const hasReasoning = config.value.reasoning
  const supported = capabilitySupportsReasoning.value === true
  const hasRange = hasThinkingBudgetSupport(capabilityReasoningPortrait.value)
  return hasReasoning && supported && hasRange
})

const showInterleavedThinking = computed(() => {
  if (!isOpenAICompatibleProvider.value || isResponsesProvider.value) {
    return false
  }

  return (
    capabilitySupportsReasoning.value === true ||
    capabilityReasoningPortrait.value?.interleaved === true ||
    typeof config.value.forceInterleavedThinkingCompat === 'boolean'
  )
})

watch(
  () => [props.providerId, props.modelId, props.open],
  async () => {
    if (props.open) await fetchCapabilities()
  },
  { immediate: true }
)

// 思考预算范围（完全由能力提供，上游保证存在）
const thinkingBudgetRange = computed(() => capabilityBudgetRange.value)

const genericThinkingBudgetError = computed(() => {
  if (!showThinkingBudget.value) return ''
  const value = config.value.thinkingBudget
  const range = thinkingBudgetRange.value
  if (value === undefined || value === null) {
    return t('settings.model.modelConfig.thinkingBudget.validation.required')
  }
  if (!range) return ''
  if (isThinkingBudgetSentinel(capabilityReasoningPortrait.value, value)) {
    return ''
  }
  if (range.min !== undefined && value < range.min) {
    return t('settings.model.modelConfig.thinkingBudget.validation.minValue')
  }
  if (range.max !== undefined && value > range.max) {
    return t('settings.model.modelConfig.thinkingBudget.validation.maxValue', { max: range.max })
  }
  return ''
})

const handleMutualExclusiveToggle = (feature: 'reasoning' | 'functionCall', enabled: boolean) => {
  if (!enabled) {
    config.value[feature] = false
    return
  }

  const oppositeFeature = feature === 'reasoning' ? 'functionCall' : 'reasoning'

  if (isDeepSeekV31Model.value && config.value[oppositeFeature]) {
    mutualExclusiveAction.value = { from: feature, to: oppositeFeature }
    showMutualExclusiveAlert.value = true
  } else {
    config.value[feature] = true
  }
}

const handleReasoningToggle = (enabled: boolean) => {
  handleMutualExclusiveToggle('reasoning', enabled)
}

const handleFunctionCallToggle = (enabled: boolean) => {
  handleMutualExclusiveToggle('functionCall', enabled)
}

const cancelMutualExclusiveToggle = () => {
  mutualExclusiveAction.value = null
  showMutualExclusiveAlert.value = false
}

const confirmMutualExclusiveToggle = () => {
  if (mutualExclusiveAction.value) {
    const { from, to } = mutualExclusiveAction.value
    config.value[from] = true
    config.value[to] = false

    mutualExclusiveAction.value = null
    showMutualExclusiveAlert.value = false
  }
}

const getConfirmMessage = computed(() => {
  if (!mutualExclusiveAction.value) return ''
  const { from } = mutualExclusiveAction.value
  return t(`dialog.mutualExclusive.message.${from}`)
})

const getConfirmTitle = computed(() => {
  if (!mutualExclusiveAction.value) return ''
  const { from } = mutualExclusiveAction.value
  return t(`dialog.mutualExclusive.title.${from}`)
})

onMounted(() => {
  if (props.open) {
    loadConfig()
  }
})

const showReasoningToggle = computed(() => {
  return capabilitySupportsReasoning.value !== false
})
</script>
