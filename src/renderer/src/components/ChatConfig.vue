<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, watch } from 'vue'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Icon } from '@iconify/vue'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useLanguageStore } from '@/stores/language'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

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

// 是否显示思考预算配置 - 支持 Gemini 2.5 系列和 Qwen3 系列
const showThinkingBudget = computed(() => {
  // Gemini 2.5 系列
  const isGemini = props.providerId === 'gemini'
  const isGemini25 = props.modelId?.includes('gemini-2.5')

  // Qwen3 系列
  const isDashscope = props.providerId === 'dashscope'
  const isQwen3 = props.modelId?.includes('qwen3')

  return (isGemini && isGemini25) || (isDashscope && isQwen3)
})

// 是否显示搜索配置 - 支持 Dashscope 的特定模型
const showSearchConfig = computed(() => {
  const isDashscope = props.providerId === 'dashscope'

  if (!isDashscope || !props.modelId) return false

  // 支持搜索的模型列表
  const enableSearchModels = [
    'qwen-max',
    'qwen-plus',
    'qwen-plus-latest',
    'qwen-plus-2025-07-14',
    'qwen-flash',
    'qwen-flash-2025-07-28',
    'qwen-turbo',
    'qwen-turbo-latest',
    'qwen-turbo-2025-07-15',
    'qwq-plus'
  ]

  return enableSearchModels.some((modelName) =>
    props.modelId?.toLowerCase().includes(modelName.toLowerCase())
  )
})

const isGPT5Model = computed(() => {
  const modelId = props.modelId?.toLowerCase() || ''
  return modelId.includes('gpt-5')
})

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

// 处理动态思维开关
const handleDynamicThinkingToggle = (enabled: boolean) => {
  if (enabled) {
    emit('update:thinkingBudget', -1) // 动态思维
  } else {
    // 设置为 1024
    emit('update:thinkingBudget', 1024)
  }
}

// 获取 Qwen3 模型的最大思考预算
const getQwen3MaxBudget = (): number => {
  const modelId = props.modelId?.toLowerCase() || ''

  // 根据不同的 Qwen3 模型返回不同的最大值
  if (modelId.includes('qwen3-235b-a22b') || modelId.includes('qwen3-30b-a3b')) {
    return 81920
  } else if (
    modelId.includes('qwen3-32b') ||
    modelId.includes('qwen3-14b') ||
    modelId.includes('qwen3-8b') ||
    modelId.includes('qwen3-4b')
  ) {
    return 38912
  } else if (modelId.includes('qwen3-1.7b') || modelId.includes('qwen3-0.6b')) {
    return 20000
  }

  // 默认值
  return 81920
}

// 获取 Gemini 模型的思考预算配置范围
const getGeminiThinkingBudgetRange = () => {
  const modelId = props.modelId?.toLowerCase() || ''

  if (modelId.includes('gemini-2.5-pro')) {
    return {
      min: 128,
      max: 32768,
      defaultValue: -1,
      canDisable: false
    }
  } else if (modelId.includes('gemini-2.5-flash-lite')) {
    return {
      min: 0,
      max: 24576,
      defaultValue: 0,
      canDisable: true
    }
  } else if (modelId.includes('gemini-2.5-flash')) {
    return {
      min: 0,
      max: 24576,
      defaultValue: -1,
      canDisable: true
    }
  }

  // 默认配置
  return {
    min: 128,
    max: 32768,
    defaultValue: -1,
    canDisable: false
  }
}

// Gemini 思考预算验证错误
const geminiThinkingBudgetError = computed(() => {
  if (props.providerId !== 'gemini' || !props.modelId?.includes('gemini-2.5')) return ''

  const value = props.thinkingBudget
  const range = getGeminiThinkingBudgetRange()

  if (value === undefined || value === null) return ''

  // -1 是有效值（动态思维）
  if (value === -1) return ''

  // 检查是否可以禁用（设置为 0）
  if (value === 0 && !range.canDisable) {
    if (props.modelId?.includes('pro')) {
      return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.proCannotDisable')
    } else {
      return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.modelCannotDisable')
    }
  }

  if (value < range.min && value !== 0) {
    // 对于 Flash-Lite，0 是有效值（停用思考），但其他值不能小于 512
    if (props.modelId?.includes('flash-lite') && value > 0 && value < 512) {
      return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.flashLiteMinValue')
    }

    let hint = ''
    if (range.canDisable && range.min === 0) {
      hint = t('settings.model.modelConfig.thinkingBudget.gemini.hints.withZeroAndDynamic')
    } else if (range.canDisable) {
      hint = t('settings.model.modelConfig.thinkingBudget.gemini.hints.withDynamic')
    } else {
      hint = t('settings.model.modelConfig.thinkingBudget.gemini.hints.withDynamic')
    }
    return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.belowMin', {
      min: range.min,
      hint
    })
  }

  if (value > range.max) {
    return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.aboveMax', {
      max: range.max
    })
  }

  return ''
})

// Qwen3 思考预算验证错误
const qwen3ThinkingBudgetError = computed(() => {
  if (props.providerId !== 'dashscope' || !props.modelId?.includes('qwen3')) return ''

  const value = props.thinkingBudget
  const maxBudget = getQwen3MaxBudget()

  if (value === undefined || value === null) {
    return ''
  }
  if (value < 1) {
    return t('settings.model.modelConfig.thinkingBudget.qwen3.validation.minValue')
  }
  if (value > maxBudget) {
    return t('settings.model.modelConfig.thinkingBudget.qwen3.validation.maxValue', {
      max: maxBudget
    })
  }

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
        <Slider v-model="temperatureValue" :min="0.1" :max="1.5" :step="0.1" />
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
                  <p v-if="props.providerId === 'gemini'">
                    {{ t('settings.model.modelConfig.thinkingBudget.gemini.description') }}
                  </p>
                  <p v-else-if="props.providerId === 'dashscope'">
                    {{ t('settings.model.modelConfig.thinkingBudget.qwen3.description') }}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <!-- Gemini 思考预算详细配置 -->
        <div v-if="props.providerId === 'gemini'" class="space-y-3 pl-4 border-l-2 border-muted">
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label class="text-sm">{{
                t('settings.model.modelConfig.thinkingBudget.gemini.dynamic')
              }}</Label>
            </div>
            <Switch
              :checked="(props.thinkingBudget ?? -1) === -1"
              @update:checked="handleDynamicThinkingToggle"
            />
          </div>

          <!-- 数值输入 -->
          <div class="space-y-2">
            <Label class="text-sm">{{
              t('settings.model.modelConfig.thinkingBudget.gemini.valueLabel')
            }}</Label>
            <Input
              v-model.number="displayThinkingBudget"
              type="number"
              :min="-1"
              :max="32768"
              :step="128"
              :placeholder="t('settings.model.modelConfig.thinkingBudget.gemini.placeholder')"
              :disabled="(props.thinkingBudget ?? -1) === -1"
              :class="{ 'border-destructive': geminiThinkingBudgetError }"
            />
            <p class="text-xs text-muted-foreground">
              <span v-if="geminiThinkingBudgetError" class="text-red-600 font-medium">
                {{ geminiThinkingBudgetError }}
              </span>
              <span v-else>
                {{
                  displayThinkingBudget === undefined
                    ? t('settings.model.modelConfig.currentUsingModelDefault')
                    : t('settings.model.modelConfig.thinkingBudget.gemini.dynamicPrefix') +
                      '，' +
                      t('settings.model.modelConfig.thinkingBudget.range', { min: -1, max: 32768 })
                }}
              </span>
            </p>
          </div>
        </div>

        <!-- Qwen3 思考预算配置 -->
        <div
          v-else-if="props.providerId === 'dashscope'"
          class="space-y-3 pl-4 border-l-2 border-muted"
        >
          <div class="space-y-2">
            <Label class="text-sm">{{
              t('settings.model.modelConfig.thinkingBudget.qwen3.valueLabel')
            }}</Label>
            <Input
              v-model.number="displayThinkingBudget"
              type="number"
              :min="1"
              :max="getQwen3MaxBudget()"
              :step="128"
              :placeholder="t('settings.model.modelConfig.thinkingBudget.qwen3.placeholder')"
              :class="{ 'border-destructive': qwen3ThinkingBudgetError }"
            />
            <p class="text-xs text-muted-foreground">
              <span v-if="qwen3ThinkingBudgetError" class="text-red-600 font-medium">
                {{ qwen3ThinkingBudgetError }}
              </span>
              <span v-else>
                {{
                  displayThinkingBudget === undefined
                    ? t('settings.model.modelConfig.currentUsingModelDefault')
                    : t('settings.model.modelConfig.thinkingBudget.range', {
                        min: 1,
                        max: getQwen3MaxBudget()
                      })
                }}
              </span>
            </p>
          </div>
        </div>
      </div>

      <!-- Search Configuration (联网搜索配置) -->
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
              :checked="props.enableSearch ?? false"
              @update:checked="(value) => emit('update:enableSearch', value)"
            />
          </div>

          <!-- 强制搜索开关 -->
          <div v-if="props.enableSearch" class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label class="text-sm">{{
                t('settings.model.modelConfig.forcedSearch.label')
              }}</Label>
            </div>
            <Switch
              :checked="props.forcedSearch ?? false"
              @update:checked="(value) => emit('update:forcedSearch', value)"
            />
          </div>

          <!-- 搜索策略选择 -->
          <div v-if="props.enableSearch" class="space-y-2">
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
            <Switch id="artifacts-mode" v-model:checked="artifactsEnabled" />
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
