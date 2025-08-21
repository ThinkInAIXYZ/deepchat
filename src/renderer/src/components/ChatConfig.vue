<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
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
  modelId?: string
  providerId?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
}>()

const systemPrompt = defineModel<string>('systemPrompt')
// Define emits to send updates to parent
const emit = defineEmits<{
  'update:temperature': [value: number]
  'update:contextLength': [value: number]
  'update:maxTokens': [value: number]
  'update:thinkingBudget': [value: number | undefined]
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

// 是否显示思考预算配置 - 只对 Gemini 2.5 系列显示
const showThinkingBudget = computed(() => {
  const isGemini = props.providerId === 'gemini'
  const isGemini25 = props.modelId?.includes('gemini-2.5')
  return isGemini && isGemini25
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
</script>

<template>
  <div class="pt-2 pb-6 px-2" :dir="langStore.dir">
    <h2 class="text-xs text-muted-foreground px-2">{{ t('settings.model.title') }}</h2>

    <div class="space-y-6">
      <!-- System Prompt -->
      <div class="space-y-2 px-2">
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

      <!-- Thinking Budget (仅对支持的 Gemini 模型显示) -->
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

        <!-- 思考预算详细配置 -->
        <div class="space-y-3 pl-4 border-l-2 border-muted">
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label class="text-sm">{{
                t('settings.model.modelConfig.thinkingBudget.dynamic')
              }}</Label>
            </div>
            <Switch
              :checked="displayThinkingBudget === -1"
              :disabled="displayThinkingBudget === undefined"
              @update:checked="handleDynamicThinkingToggle"
            />
          </div>

          <!-- 数值输入 -->
          <div class="space-y-2">
            <Label class="text-sm">{{
              t('settings.model.modelConfig.thinkingBudget.valueLabel')
            }}</Label>
            <Input
              v-model.number="displayThinkingBudget"
              type="number"
              :min="-1"
              :max="32768"
              :step="128"
              :placeholder="
                displayThinkingBudget === undefined
                  ? t('settings.model.modelConfig.useModelDefault')
                  : t('settings.model.modelConfig.thinkingBudget.placeholder')
              "
              :disabled="displayThinkingBudget === -1 || displayThinkingBudget === undefined"
            />
            <p class="text-xs text-muted-foreground">
              {{
                displayThinkingBudget === undefined
                  ? t('settings.model.modelConfig.currentUsingModelDefault')
                  : t('settings.model.modelConfig.thinkingBudget.dynamicPrefix') +
                    '，' +
                    t('settings.model.modelConfig.thinkingBudget.range', { min: -1, max: 32768 })
              }}
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
          </SelectContent>
        </Select>
      </div>

      <!-- Verbosity (详细程度 - 仅 GPT-5 系列) -->
      <div v-if="isGPT5Model && verbosity !== undefined" class="space-y-4 px-2">
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
