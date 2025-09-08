<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ t('settings.model.modelConfig.title') }} - {{ modelName }}</DialogTitle>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.model.modelConfig.description') }}
        </p>
      </DialogHeader>

      <div class="overflow-y-auto flex-1 pr-2 -mr-2">
        <form @submit.prevent="handleSave" class="space-y-6">
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

          <!-- 视觉能力 -->
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>{{ t('settings.model.modelConfig.vision.label') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.model.modelConfig.vision.description') }}
              </p>
            </div>
            <Switch v-model:checked="config.vision" />
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
            <Switch :checked="config.functionCall" @update:checked="handleFunctionCallToggle" />
          </div>

          <!-- 推理能力 -->
          <div class="flex items-center justify-between">
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
            <Switch :checked="config.reasoning" @update:checked="handleReasoningToggle" />
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
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.reasoningEffort.description') }}
            </p>
          </div>

          <!-- GPT-5 系列模型的详细程度 -->
          <div v-if="isGPT5Model" class="space-y-2">
            <Label for="verbosity">{{ t('settings.model.modelConfig.verbosity.label') }}</Label>
            <Select v-model="config.verbosity">
              <SelectTrigger>
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
            <p class="text-xs text-muted-foreground">
              {{ t('settings.model.modelConfig.verbosity.description') }}
            </p>
          </div>

          <!-- 思考预算 (Gemini 模型) -->
          <div v-if="showGeminiThinkingBudget" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label>{{ t('settings.model.modelConfig.thinkingBudget.label') }}</Label>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.model.modelConfig.thinkingBudget.gemini.description') }}
                </p>
                <p class="text-xs text-orange-600">
                  {{ t('settings.model.modelConfig.thinkingBudget.gemini.forceEnabled') }}
                </p>
              </div>
              <!-- Gemini 2.5 系列强制开启，不显示开关 -->
            </div>

            <!-- 思考预算详细配置 -->
            <div class="space-y-3 pl-4 border-l-2 border-muted">
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <Label class="text-sm">{{
                    t('settings.model.modelConfig.thinkingBudget.gemini.dynamic')
                  }}</Label>
                </div>
                <Switch
                  :checked="config.thinkingBudget === -1"
                  @update:checked="handleDynamicThinkingToggle"
                />
              </div>

              <!-- 数值输入 -->
              <div class="space-y-2">
                <Label class="text-sm">{{
                  t('settings.model.modelConfig.thinkingBudget.gemini.valueLabel')
                }}</Label>
                <Input
                  v-model.number="config.thinkingBudget"
                  type="number"
                  :min="-1"
                  :max="thinkingBudgetRange.max"
                  :step="128"
                  :placeholder="t('settings.model.modelConfig.thinkingBudget.gemini.placeholder')"
                  :class="{ 'border-destructive': thinkingBudgetError }"
                  :disabled="config.thinkingBudget === -1"
                />
                <p class="text-xs text-muted-foreground">
                  <span v-if="thinkingBudgetError" class="text-red-600 font-medium">
                    {{ t('settings.model.modelConfig.thinkingBudget.gemini.notice')
                    }}{{ thinkingBudgetError }}。
                  </span>
                  <span v-else-if="props.modelId.includes('pro')" class="text-red-600 font-medium">
                    {{ t('settings.model.modelConfig.thinkingBudget.gemini.notice')
                    }}{{
                      t('settings.model.modelConfig.thinkingBudget.gemini.warnings.proNoDisable')
                    }}。
                  </span>
                  {{ t('settings.model.modelConfig.thinkingBudget.gemini.dynamicPrefix')
                  }}{{ getDisableHint() }}，{{
                    t('settings.model.modelConfig.thinkingBudget.range', thinkingBudgetRange)
                  }}
                </p>
              </div>
            </div>
          </div>

          <!-- 思考预算 (Qwen3 模型) -->
          <div v-if="showQwen3ThinkingBudget" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label>{{ t('settings.model.modelConfig.thinkingBudget.label') }}</Label>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.model.modelConfig.thinkingBudget.qwen3.description') }}
                </p>
              </div>
            </div>

            <!-- Qwen3 思考预算配置 -->
            <div class="space-y-3 pl-4 border-l-2 border-muted">
              <!-- 数值输入 -->
              <div class="space-y-2">
                <Label class="text-sm">{{
                  t('settings.model.modelConfig.thinkingBudget.qwen3.valueLabel')
                }}</Label>
                <Input
                  v-model.number="config.thinkingBudget"
                  type="number"
                  :min="1"
                  :max="thinkingBudgetRange.max"
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
                      t('settings.model.modelConfig.thinkingBudget.range', {
                        min: 1,
                        max: thinkingBudgetRange.max
                      })
                    }}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <!-- 联网搜索 (DashScope 支持搜索的模型) -->
          <div v-if="showDashScopeSearch" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label>{{ t('settings.model.modelConfig.enableSearch.label') }}</Label>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.model.modelConfig.enableSearch.description') }}
                </p>
              </div>
              <Switch v-model:checked="config.enableSearch" />
            </div>

            <!-- 搜索配置子选项 -->
            <div v-if="config.enableSearch" class="space-y-3 pl-4 border-l-2 border-muted">
              <!-- 强制搜索 -->
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <Label class="text-sm">{{
                    t('settings.model.modelConfig.forcedSearch.label')
                  }}</Label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.model.modelConfig.forcedSearch.description') }}
                  </p>
                </div>
                <Switch v-model:checked="config.forcedSearch" />
              </div>

              <!-- 搜索策略 -->
              <div class="space-y-2">
                <Label class="text-sm">{{
                  t('settings.model.modelConfig.searchStrategy.label')
                }}</Label>
                <Select v-model="config.searchStrategy">
                  <SelectTrigger>
                    <SelectValue
                      :placeholder="t('settings.model.modelConfig.searchStrategy.placeholder')"
                    />
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
import { useI18n } from 'vue-i18n'
import { ModelType } from '@shared/model'
import type { ModelConfig } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

interface Props {
  open: boolean
  modelId: string
  modelName: string
  providerId: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [boolean]
  saved: []
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()

// 配置数据
const config = ref<ModelConfig>({
  maxTokens: 4096,
  contextLength: 8192,
  temperature: 0.7,
  vision: false,
  functionCall: false,
  reasoning: false,
  type: ModelType.Chat,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  enableSearch: false,
  forcedSearch: false,
  searchStrategy: 'turbo'
})

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

// 加载模型配置
const loadConfig = async () => {
  if (!props.modelId || !props.providerId) return

  try {
    const modelConfig = await settingsStore.getModelConfig(props.modelId, props.providerId)
    config.value = { ...modelConfig }
  } catch (error) {
    console.error('Failed to load model config:', error)

    const defaultConfig: ModelConfig = {
      maxTokens: 4096,
      contextLength: 8192,
      temperature: 0.7,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: ModelType.Chat,
      reasoningEffort: 'medium',
      verbosity: 'medium',
      enableSearch: false,
      forcedSearch: false,
      searchStrategy: 'turbo'
    }

    config.value = defaultConfig
  }

  // Initialize thinking budget if not set
  if (props.providerId === 'gemini' && config.value.thinkingBudget === undefined) {
    const thinkingConfig = getThinkingBudgetConfig(props.modelId)
    if (thinkingConfig) {
      config.value.thinkingBudget = thinkingConfig.defaultValue
    }
  }

  if (
    props.providerId === 'dashscope' &&
    props.modelId.includes('qwen3') &&
    config.value.thinkingBudget === undefined
  ) {
    const thinkingConfig = getThinkingBudgetConfig(props.modelId)
    if (thinkingConfig) {
      config.value.thinkingBudget = thinkingConfig.defaultValue
    }
  }
}

// 验证表单
const validateForm = () => {
  errors.value = {}

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
}

// 表单是否有效
const isValid = computed(() => {
  validateForm()
  return (
    Object.keys(errors.value).length === 0 &&
    !thinkingBudgetError.value &&
    !qwen3ThinkingBudgetError.value
  )
})

// 保存配置
const handleSave = async () => {
  if (!isValid.value) return

  try {
    await settingsStore.setModelConfig(props.modelId, props.providerId, config.value)
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
    await settingsStore.resetModelConfig(props.modelId, props.providerId)
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

// 根据模型 ID 获取思考预算配置
const getThinkingBudgetConfig = (modelId: string) => {
  // Gemini 系列模型配置
  if (modelId.includes('gemini-2.5-pro')) {
    return {
      min: 128,
      max: 32768,
      defaultValue: -1, // 默认动态思维
      canDisable: false // 2.5 Pro 无法停用思考
    }
  }

  if (modelId.includes('gemini-2.5-flash-lite')) {
    return {
      min: 0, // 支持设置为 0（停用思考）
      max: 24576,
      defaultValue: 0, // 默认不思考
      canDisable: true // 可以设置为 0 停用思考
    }
  }

  if (modelId.includes('gemini-2.5-flash')) {
    return {
      min: 0,
      max: 24576,
      defaultValue: -1, // 默认动态思维
      canDisable: true // 可以设置为 0 停用
    }
  }

  // Qwen3 系列模型配置
  if (modelId.includes('qwen3-235b-a22b')) {
    return {
      min: 0,
      max: 81920,
      defaultValue: 81920,
      canDisable: true
    }
  }

  if (modelId.includes('qwen3-30b-a3b')) {
    return {
      min: 0,
      max: 81920,
      defaultValue: 81920,
      canDisable: true
    }
  }

  if (
    modelId.includes('qwen3-32b') ||
    modelId.includes('qwen3-14b') ||
    modelId.includes('qwen3-8b') ||
    modelId.includes('qwen3-4b')
  ) {
    return {
      min: 0,
      max: 38912,
      defaultValue: 38912,
      canDisable: true
    }
  }

  if (modelId.includes('qwen3-1.7b') || modelId.includes('qwen3-0.6b')) {
    return {
      min: 0,
      max: 20000,
      defaultValue: 20000,
      canDisable: true
    }
  }

  return null // 不支持的模型
}

const isGPT5Model = computed(() => {
  const modelId = props.modelId.toLowerCase()
  return modelId.includes('gpt-5')
})

const isDeepSeekV31Model = computed(() => {
  const modelId = props.modelId.toLowerCase()
  return modelId.includes('deepseek-v3.1') || modelId.includes('deepseek-v3-1')
})

const supportsReasoningEffort = computed(() => {
  return config.value.reasoningEffort !== undefined && config.value.reasoningEffort !== null
})

// 是否显示Gemini思考预算配置
const showGeminiThinkingBudget = computed(() => {
  const isGemini = props.providerId === 'gemini'
  const hasReasoning = config.value.reasoning
  const modelConfig = getThinkingBudgetConfig(props.modelId)
  const isSupported = modelConfig !== null
  return isGemini && hasReasoning && isSupported
})

// 是否显示Qwen3思考预算配置
const showQwen3ThinkingBudget = computed(() => {
  const isDashscope = props.providerId === 'dashscope'
  const hasReasoning = config.value.reasoning
  const isQwen3Model = props.modelId.includes('qwen3')
  const modelConfig = getThinkingBudgetConfig(props.modelId)
  const isSupported = modelConfig !== null
  return isDashscope && hasReasoning && isQwen3Model && isSupported
})

// 是否显示DashScope搜索配置
const showDashScopeSearch = computed(() => {
  const isDashscope = props.providerId === 'dashscope'
  const modelId = props.modelId.toLowerCase()
  // DashScope 支持搜索的模型列表
  const supportedModels = ['qwen-max', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwq-plus']
  const isSupported = supportedModels.some((supportedModel) => modelId.includes(supportedModel))
  return isDashscope && isSupported
})

// 思考预算范围
const thinkingBudgetRange = computed(() => {
  const modelConfig = getThinkingBudgetConfig(props.modelId)
  return modelConfig || { min: 128, max: 32768, defaultValue: -1, canDisable: false }
})

// Gemini思考预算验证错误
const thinkingBudgetError = computed(() => {
  if (!showGeminiThinkingBudget.value) return ''

  const value = config.value.thinkingBudget
  const range = thinkingBudgetRange.value

  if (value === undefined || value === null) return ''

  // -1 是有效值（动态思维）
  if (value === -1) return ''

  // 检查是否可以禁用（设置为 0）
  if (value === 0 && !range.canDisable) {
    if (props.modelId.includes('pro')) {
      return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.proCannotDisable')
    } else if (props.modelId.includes('flash-lite')) {
      return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.flashLiteCannotSetZero')
    } else {
      return t('settings.model.modelConfig.thinkingBudget.gemini.warnings.modelCannotDisable')
    }
  }

  if (value < range.min && value !== 0) {
    // 对于 Flash-Lite，0 是有效值（停用思考），但其他值不能小于 512
    if (props.modelId.includes('flash-lite') && value > 0 && value < 512) {
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

// Qwen3思考预算验证错误
const qwen3ThinkingBudgetError = computed(() => {
  if (!showQwen3ThinkingBudget.value) return ''

  const value = config.value.thinkingBudget
  const range = thinkingBudgetRange.value

  if (value === undefined || value === null) {
    return t('settings.model.modelConfig.thinkingBudget.qwen3.validation.required')
  }
  if (value < 1) {
    return t('settings.model.modelConfig.thinkingBudget.qwen3.validation.minValue')
  }
  if (value > range.max) {
    return t('settings.model.modelConfig.thinkingBudget.qwen3.validation.maxValue', {
      max: range.max
    })
  }

  return ''
})

// 处理动态思维开关
const handleDynamicThinkingToggle = (enabled: boolean) => {
  if (enabled) {
    config.value.thinkingBudget = -1 // 动态思维
  } else {
    // 设置为 1024（Gemini Demo的默认值）
    config.value.thinkingBudget = 1024
  }
}

// 获取禁用提示文字
const getDisableHint = () => {
  const range = thinkingBudgetRange.value
  if (props.modelId.includes('flash-lite')) {
    return t('settings.model.modelConfig.thinkingBudget.gemini.hints.flashLiteDisable')
  } else if (range.canDisable) {
    return t('settings.model.modelConfig.thinkingBudget.gemini.hints.normalDisable')
  } else {
    return '' // Pro 模型的限制已在红色警告中显示
  }
}

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
</script>
