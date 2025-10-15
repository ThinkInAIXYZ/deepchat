<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, watch, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { usePresenter } from '@/composables/usePresenter'
import { Label } from '@shadcn/components/ui/label'
import { Slider } from '@shadcn/components/ui/slider'
import { Icon } from '@iconify/vue'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { useLanguageStore } from '@/stores/language'
import { Input } from '@shadcn/components/ui/input'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'

// Define props to receive config from parent
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

// 判断是否为图片生成模型
const isImageGenerationModel = computed(() => {
  return props.modelType === 'imageGeneration'
})

// 当模型类型改变且为图片生成模型时，清空系统提示词
watch(
  () => props.modelType,
  (newType) => {
    if (newType === 'imageGeneration' && systemPrompt.value) {
      systemPrompt.value = ''
    }
  }
)
// Define emits to send updates to parent
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
  // 'update:artifacts': [value: 0 | 1]
}>()

const { t } = useI18n()
const langStore = useLanguageStore()
const settingsStore = useSettingsStore()
const configPresenter = usePresenter('configPresenter')
const modelReasoning = ref(false)

const getModelReasoning = async () => {
  if (!props.modelId || !props.providerId) return false
  try {
    const modelConfig = await settingsStore.getModelConfig(props.modelId, props.providerId)
    return modelConfig.reasoning || false
  } catch (error) {
    return false
  }
}

watch(
  () => [props.modelId, props.providerId],
  async () => {
    modelReasoning.value = await getModelReasoning()
  },
  { immediate: true }
)
// Create computed properties for slider values (which expect arrays)
const temperatureValue = computed({
  get: () => [props.temperature],
  set: (value) => emit('update:temperature', value[0])
})

const contextLengthValue = computed({
  get: () => [props.contextLength],
  set: (value) => emit('update:contextLength', value[0])
})

const maxTokensValue = computed({
  get: () => [props.maxTokens],
  set: (value) => emit('update:maxTokens', value[0])
})

// Computed property for artifacts toggle
// const artifactsEnabled = computed({
//   get: () => props.artifacts === 1,
//   set: (value) => emit('update:artifacts', value ? 1 : 0)
// })

const formatSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)}M`
  } else if (size >= 1024) {
    return `${(size / 1024).toFixed(1)}K`
  }
  return `${size}`
}

// 能力：统一控制思考预算和搜索配置显示
const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityBudgetRange = ref<{ min?: number; max?: number; default?: number } | null>(null)
const capabilitySupportsSearch = ref<boolean | null>(null)
const capabilitySearchDefaults = ref<{
  default?: boolean
  forced?: boolean
  strategy?: 'turbo' | 'max'
} | null>(null)

const fetchCapabilities = async () => {
  if (!props.providerId || !props.modelId) {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsSearch.value = null
    return
  }
  try {
    const [sr, br, ss, sd] = await Promise.all([
      configPresenter.supportsReasoningCapability?.(props.providerId, props.modelId),
      configPresenter.getThinkingBudgetRange?.(props.providerId, props.modelId),
      configPresenter.supportsSearchCapability?.(props.providerId, props.modelId),
      configPresenter.getSearchDefaults?.(props.providerId, props.modelId)
    ])
    capabilitySupportsReasoning.value = typeof sr === 'boolean' ? sr : null
    capabilityBudgetRange.value = br || {}
    capabilitySupportsSearch.value = typeof ss === 'boolean' ? ss : null
    capabilitySearchDefaults.value = sd || null
  } catch {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsSearch.value = null
    capabilitySearchDefaults.value = null
  }
}

watch(
  () => [props.providerId, props.modelId],
  async () => {
    await fetchCapabilities()
  },
  { immediate: true }
)

const showThinkingBudget = computed(() => {
  return (
    modelReasoning.value &&
    capabilitySupportsReasoning.value === true &&
    !!capabilityBudgetRange.value &&
    (capabilityBudgetRange.value!.min !== undefined ||
      capabilityBudgetRange.value!.max !== undefined ||
      capabilityBudgetRange.value!.default !== undefined)
  )
})

// 是否显示搜索配置（统一基于能力）
const showSearchConfig = computed(() => capabilitySupportsSearch.value === true)

const hasForcedSearchOption = computed(() => capabilitySearchDefaults.value?.forced !== undefined)
const hasSearchStrategyOption = computed(
  () => capabilitySearchDefaults.value?.strategy !== undefined
)

const isGPT5Model = computed(() => {
  const modelId = props.modelId?.toLowerCase() || ''
  return modelId.includes('gpt-5')
})

const isGeminiProvider = computed(() => props.providerId?.toLowerCase() === 'gemini')

// 判断模型是否支持 reasoningEffort 参数
const supportsReasoningEffort = computed(() => {
  return props.reasoningEffort !== undefined
})

// 当前显示的思考预算值
const displayThinkingBudget = computed({
  get: () => {
    // 如果对话有设置值，显示对话的值
    if (props.thinkingBudget !== undefined) {
      return props.thinkingBudget
    }
    // 如果对话没有设置，显示空值（让用户知道这是未设置状态）
    return undefined
  },
  set: (value) => {
    emit('update:thinkingBudget', value)
  }
})
// 通用思考预算验证错误
const genericThinkingBudgetError = computed(() => {
  const value = props.thinkingBudget
  const range = capabilityBudgetRange.value
  if (value === undefined || value === null || !range) return ''
  if (isGeminiProvider.value && value === -1) return ''
  if (range.min !== undefined && value < range.min)
    return t('settings.model.modelConfig.thinkingBudget.validation.minValue')
  if (range.max !== undefined && value > range.max)
    return t('settings.model.modelConfig.thinkingBudget.validation.maxValue', { max: range.max })
  return ''
})
</script>

<template>
  <div class="pt-2 pb-6 px-2" :dir="langStore.dir">
    <div class="flex items-center gap-2 px-2 mb-2">
      <h2 class="text-xs text-muted-foreground">{{ t('settings.model.title') }}</h2>
      <Icon
        v-if="props.modelType === 'chat'"
        icon="lucide:message-circle"
        class="w-3 h-3 text-muted-foreground"
      />
      <Icon
        v-else-if="props.modelType === 'imageGeneration'"
        icon="lucide:image"
        class="w-3 h-3 text-muted-foreground"
      />
      <Icon
        v-else-if="props.modelType === 'embedding'"
        icon="lucide:layers"
        class="w-3 h-3 text-muted-foreground"
      />
      <Icon
        v-else-if="props.modelType === 'rerank'"
        icon="lucide:arrow-up-down"
        class="w-3 h-3 text-muted-foreground"
      />
    </div>

    <div class="space-y-6">
      <!-- System Prompt (隐藏图片生成模型的系统提示词) -->
      <div v-if="!isImageGenerationModel" class="space-y-2 px-2">
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

      <!-- Temperature (GPT-5 系列模型不显示) -->
      <div v-if="!isGPT5Model" class="space-y-4 px-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Icon icon="lucide:thermometer" class="w-4 h-4 text-muted-foreground" />
            <Label class="text-xs font-medium">{{ t('settings.model.temperature.label') }}</Label>
            <TooltipProvider :delayDuration="200">
              <Tooltip>
                <TooltipTrigger>
                  <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ t('settings.model.temperature.description') }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span class="text-xs text-muted-foreground">{{ temperatureValue[0] }}</span>
        </div>
        <Slider v-model="temperatureValue" :min="0" :max="1.5" :step="0.1" />
      </div>

      <!-- Context Length -->
      <div class="space-y-4 px-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Icon icon="lucide:pencil-ruler" class="w-4 h-4 text-muted-foreground" />
            <Label class="text-xs font-medium">{{ t('settings.model.contextLength.label') }}</Label>
            <TooltipProvider :delayDuration="200">
              <Tooltip>
                <TooltipTrigger>
                  <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ t('settings.model.contextLength.description') }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span class="text-xs text-muted-foreground">{{ formatSize(contextLengthValue[0]) }}</span>
        </div>
        <Slider
          v-model="contextLengthValue"
          :min="2048"
          :max="contextLengthLimit ?? 16384"
          :step="1024"
        />
      </div>

      <!-- Response Length -->
      <div class="space-y-4 px-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Icon icon="lucide:message-circle-reply" class="w-4 h-4 text-muted-foreground" />
            <Label class="text-xs font-medium">{{
              t('settings.model.responseLength.label')
            }}</Label>
            <TooltipProvider :delayDuration="200">
              <Tooltip>
                <TooltipTrigger>
                  <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ t('settings.model.responseLength.description') }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span class="text-xs text-muted-foreground">{{ formatSize(maxTokensValue[0]) }}</span>
        </div>
        <Slider
          v-model="maxTokensValue"
          :min="1024"
          :max="!maxTokensLimit || maxTokensLimit < 8192 ? 8192 : maxTokensLimit"
          :step="128"
        />
      </div>

      <!-- Thinking Budget (支持 Gemini 2.5 系列和 Qwen3 系列) -->
      <div v-if="showThinkingBudget" class="space-y-4 px-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Icon icon="lucide:brain" class="w-4 h-4 text-muted-foreground" />
            <Label class="text-xs font-medium">{{
              t('settings.model.modelConfig.thinkingBudget.label')
            }}</Label>
            <TooltipProvider :delayDuration="200">
              <Tooltip>
                <TooltipTrigger>
                  <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ t('settings.model.modelConfig.thinkingBudget.description') }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <!-- 通用思考预算配置（基于能力） -->
        <div class="space-y-3 pl-4 border-l-2 border-muted">
          <div class="space-y-2">
            <Label class="text-sm">{{
              t('settings.model.modelConfig.thinkingBudget.label')
            }}</Label>
            <Input
              v-model.number="displayThinkingBudget"
              type="number"
              :min="capabilityBudgetRange?.min"
              :max="capabilityBudgetRange?.max"
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
                  displayThinkingBudget === undefined
                    ? t('settings.model.modelConfig.currentUsingModelDefault')
                    : t('settings.model.modelConfig.thinkingBudget.range', {
                        min: capabilityBudgetRange?.min,
                        max: capabilityBudgetRange?.max
                      })
                }}
              </span>
            </p>
          </div>
        </div>
      </div>

      <!-- Search Configuration（统一基于能力） -->
      <div v-if="showSearchConfig" class="space-y-4 px-2">
        <div class="flex items-center space-x-2">
          <Icon icon="lucide:search" class="w-4 h-4 text-muted-foreground" />
          <Label class="text-xs font-medium">{{
            t('settings.model.modelConfig.enableSearch.label')
          }}</Label>
          <TooltipProvider :delayDuration="200">
            <Tooltip>
              <TooltipTrigger>
                <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('settings.model.modelConfig.enableSearch.description') }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div class="space-y-3 pl-4 border-l-2 border-muted">
          <!-- 启用搜索开关 -->
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label class="text-sm">{{
                t('settings.model.modelConfig.enableSearch.label')
              }}</Label>
            </div>
            <Switch
              :model-value="props.enableSearch ?? false"
              @update:model-value="(value) => emit('update:enableSearch', value)"
            />
          </div>

          <!-- 强制搜索（若能力提供默认项，则视为支持该配置） -->
          <div
            v-if="props.enableSearch && hasForcedSearchOption"
            class="flex items-center justify-between"
          >
            <div class="space-y-0.5">
              <Label class="text-sm">{{
                t('settings.model.modelConfig.forcedSearch.label')
              }}</Label>
            </div>
            <Switch
              :model-value="props.forcedSearch ?? false"
              @update:model-value="(value) => emit('update:forcedSearch', value)"
            />
          </div>
          <!-- 搜索策略（若能力提供默认项，则视为支持该配置） -->
          <div v-if="props.enableSearch && hasSearchStrategyOption" class="space-y-2">
            <Label class="text-sm">{{
              t('settings.model.modelConfig.searchStrategy.label')
            }}</Label>
            <Select
              :model-value="props.searchStrategy ?? 'turbo'"
              @update:model-value="
                (value) => emit('update:searchStrategy', value as 'turbo' | 'max')
              "
            >
              <SelectTrigger class="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="turbo">{{
                  t('settings.model.modelConfig.searchStrategy.options.turbo')
                }}</SelectItem>
                <SelectItem value="max">{{
                  t('settings.model.modelConfig.searchStrategy.options.max')
                }}</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.searchStrategy.description') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Reasoning Effort (推理努力程度) -->
      <div v-if="supportsReasoningEffort" class="space-y-4 px-2">
        <div class="flex items-center space-x-2">
          <Icon icon="lucide:brain" class="w-4 h-4 text-muted-foreground" />
          <Label class="text-xs font-medium">{{
            t('settings.model.modelConfig.reasoningEffort.label')
          }}</Label>
          <TooltipProvider :delayDuration="200">
            <Tooltip>
              <TooltipTrigger>
                <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('settings.model.modelConfig.reasoningEffort.description') }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          :model-value="props.reasoningEffort"
          @update:model-value="
            (value) =>
              emit('update:reasoningEffort', value as 'minimal' | 'low' | 'medium' | 'high')
          "
        >
          <SelectTrigger class="text-xs">
            <SelectValue
              :placeholder="t('settings.model.modelConfig.reasoningEffort.placeholder')"
            />
          </SelectTrigger>
          <SelectContent>
            <!-- Grok models only support low and high -->
            <template v-if="props.providerId === 'grok'">
              <SelectItem value="low">{{
                t('settings.model.modelConfig.reasoningEffort.options.low')
              }}</SelectItem>
              <SelectItem value="high">{{
                t('settings.model.modelConfig.reasoningEffort.options.high')
              }}</SelectItem>
            </template>
            <!-- Other models support all four options -->
            <template v-else>
              <SelectItem value="minimal">{{
                t('settings.model.modelConfig.reasoningEffort.options.minimal')
              }}</SelectItem>
              <SelectItem value="low">{{
                t('settings.model.modelConfig.reasoningEffort.options.low')
              }}</SelectItem>
              <SelectItem value="medium">{{
                t('settings.model.modelConfig.reasoningEffort.options.medium')
              }}</SelectItem>
              <SelectItem value="high">{{
                t('settings.model.modelConfig.reasoningEffort.options.high')
              }}</SelectItem>
            </template>
          </SelectContent>
        </Select>
      </div>

      <!-- Verbosity (详细程度 - 仅 GPT-5 系列) -->
      <div v-if="isGPT5Model && props.verbosity !== undefined" class="space-y-4 px-2">
        <div class="flex items-center space-x-2">
          <Icon icon="lucide:message-square-text" class="w-4 h-4 text-muted-foreground" />
          <Label class="text-xs font-medium">{{
            t('settings.model.modelConfig.verbosity.label')
          }}</Label>
          <TooltipProvider :delayDuration="200">
            <Tooltip>
              <TooltipTrigger>
                <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('settings.model.modelConfig.verbosity.description') }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          :model-value="props.verbosity"
          @update:model-value="
            (value) => emit('update:verbosity', value as 'low' | 'medium' | 'high')
          "
        >
          <SelectTrigger class="text-xs">
            <SelectValue :placeholder="t('settings.model.modelConfig.verbosity.placeholder')" />
          </SelectTrigger>
          <SelectContent>
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

      <!-- Artifacts Toggle -->
      <!-- <div class="space-y-2 px-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Label for="artifacts-mode">Artifacts</Label>
            <Switch
              id="artifacts-mode"
              :model-value="artifactsEnabled"
              @update:model-value="(value) => (artifactsEnabled = value)"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ t('settings.model.artifacts.description') }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div> -->
    </div>
  </div>
</template>
