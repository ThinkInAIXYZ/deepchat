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

          <!-- 详细程度（存在该参数即显示） -->
          <div v-if="supportsVerbosity" class="space-y-2">
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

          <!-- 联网搜索（统一基于能力） -->
          <div v-if="showSearchConfig" class="space-y-4">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <Label>{{ t('settings.model.modelConfig.enableSearch.label') }}</Label>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.model.modelConfig.enableSearch.description') }}
                </p>
              </div>
              <Switch
                :model-value="config.enableSearch"
                @update:model-value="(value) => (config.enableSearch = value)"
              />
            </div>

            <!-- 搜索配置子选项 -->
            <div v-if="config.enableSearch" class="space-y-3 pl-4 border-l-2 border-muted">
              <!-- 强制搜索（若能力提供默认项，则视为支持该配置） -->
              <div v-if="hasForcedSearchOption" class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <Label class="text-sm">{{
                    t('settings.model.modelConfig.forcedSearch.label')
                  }}</Label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.model.modelConfig.forcedSearch.description') }}
                  </p>
                </div>
                <Switch v-model:model-value="config.forcedSearch" />
              </div>

              <!-- 搜索策略（若能力提供默认项，则视为支持该配置） -->
              <div v-if="hasSearchStrategyOption" class="space-y-2">
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
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ApiEndpointType, ModelType } from '@shared/model'
import type { ModelConfig } from '@shared/presenter'
import { useModelConfigStore } from '@/stores/modelConfigStore'
import { useModelStore } from '@/stores/modelStore'
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
const { customModels, allProviderModels } = storeToRefs(modelStore)
const configPresenter = usePresenter('configPresenter')

const isOpenAICompatibleProvider = computed(() => {
  const EXCLUDED_PROVIDERS = [
    'anthropic',
    'gemini',
    'vertex',
    'aws-bedrock',
    'github-copilot',
    'ollama',
    'acp'
  ]
  const providerId = props.providerId?.toLowerCase() || ''
  return !EXCLUDED_PROVIDERS.some((excluded) => providerId.includes(excluded))
})

const showApiEndpointSelector = computed(() => isOpenAICompatibleProvider.value)

const createDefaultConfig = (): ModelConfig => ({
  maxTokens: 4096,
  contextLength: 8192,
  temperature: 0.7,
  vision: false,
  functionCall: false,
  reasoning: false,
  type: ModelType.Chat,
  apiEndpoint: ApiEndpointType.Chat,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  enableSearch: false,
  forcedSearch: false,
  searchStrategy: 'turbo'
})

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
  contextLength: config.value.contextLength ?? 4096,
  maxTokens: config.value.maxTokens ?? 2048,
  vision: config.value.vision ?? false,
  functionCall: config.value.functionCall ?? false,
  reasoning: config.value.reasoning ?? false,
  enableSearch: config.value.enableSearch ?? false,
  type: config.value.type ?? ModelType.Chat
})

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
    await fetchCapabilities()
    return
  }

  if (!props.modelId) return

  try {
    const modelConfig = await modelConfigStore.getModelConfig(props.modelId, props.providerId)
    config.value = { ...modelConfig }

    if (isOpenAICompatibleProvider.value && !config.value.apiEndpoint) {
      config.value.apiEndpoint = ApiEndpointType.Chat
    }
  } catch (error) {
    console.error('Failed to load model config:', error)
    config.value = createDefaultConfig()
  }

  await fetchCapabilities()

  if (config.value.isUserDefined !== true) {
    if (capabilitySupportsEffort.value === true && config.value.reasoningEffort === undefined) {
      if (capabilityEffortDefault.value) {
        config.value.reasoningEffort = capabilityEffortDefault.value
      }
    }

    if (capabilitySupportsVerbosity.value === true && config.value.verbosity === undefined) {
      if (capabilityVerbosityDefault.value) {
        config.value.verbosity = capabilityVerbosityDefault.value
      }
    }
  }

  if (config.value.thinkingBudget === undefined) {
    const range = capabilityBudgetRange.value
    if (range && typeof range.default === 'number') {
      config.value.thinkingBudget = range.default
    }
    if (capabilitySupportsSearch.value === true && capabilitySearchDefaults.value) {
      if (config.value.isUserDefined !== true) {
        const def = capabilitySearchDefaults.value
        if (typeof def.default === 'boolean') config.value.enableSearch = def.default
        if (typeof def.forced === 'boolean') config.value.forcedSearch = def.forced
        if (def.strategy === 'turbo' || def.strategy === 'max')
          config.value.searchStrategy = def.strategy
      }
    }
  }

  if (capabilitySupportsSearch.value === true && capabilitySearchDefaults.value) {
    if (config.value.isUserDefined !== true) {
      const def = capabilitySearchDefaults.value
      if (typeof def.default === 'boolean') config.value.enableSearch = def.default
      if (typeof def.forced === 'boolean') config.value.forcedSearch = def.forced
      if (def.strategy === 'turbo' || def.strategy === 'max')
        config.value.searchStrategy = def.strategy
    }
  }
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
          enableSearch: config.value.enableSearch,
          type: config.value.type ?? ModelType.Chat
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

const supportsVerbosity = computed(() => capabilitySupportsVerbosity.value === true)

const isDeepSeekV31Model = computed(() => {
  const modelId = props.modelId.toLowerCase()
  return modelId.includes('deepseek-v3.1') || modelId.includes('deepseek-v3-1')
})

const isGeminiProvider = computed(() => props.providerId?.toLowerCase() === 'gemini')

const supportsReasoningEffort = computed(() => capabilitySupportsEffort.value === true)

const showThinkingBudget = computed(() => {
  const hasReasoning = config.value.reasoning
  const supported = capabilitySupportsReasoning.value === true
  const hasRange = !!thinkingBudgetRange.value && thinkingBudgetRange.value.max !== undefined
  return hasReasoning && supported && hasRange
})

const capabilitySupportsReasoning = ref<boolean | null>(null)
const capabilityBudgetRange = ref<{ min?: number; max?: number; default?: number } | null>(null)
const capabilitySupportsSearch = ref<boolean | null>(null)
const capabilitySearchDefaults = ref<{
  default?: boolean
  forced?: boolean
  strategy?: 'turbo' | 'max'
} | null>(null)
const capabilitySupportsEffort = ref<boolean | null>(null)
const capabilityEffortDefault = ref<'minimal' | 'low' | 'medium' | 'high' | undefined>(undefined)
const capabilitySupportsVerbosity = ref<boolean | null>(null)
const capabilityVerbosityDefault = ref<'low' | 'medium' | 'high' | undefined>(undefined)

const fetchCapabilities = async () => {
  if (!props.providerId || !props.modelId) {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsSearch.value = null
    return
  }
  try {
    const [sr, br, ss, sd, se, ed, sv, vd] = await Promise.all([
      configPresenter.supportsReasoningCapability?.(props.providerId, props.modelId),
      configPresenter.getThinkingBudgetRange?.(props.providerId, props.modelId),
      configPresenter.supportsSearchCapability?.(props.providerId, props.modelId),
      configPresenter.getSearchDefaults?.(props.providerId, props.modelId),
      configPresenter.supportsReasoningEffortCapability?.(props.providerId, props.modelId),
      configPresenter.getReasoningEffortDefault?.(props.providerId, props.modelId),
      configPresenter.supportsVerbosityCapability?.(props.providerId, props.modelId),
      configPresenter.getVerbosityDefault?.(props.providerId, props.modelId)
    ])
    capabilitySupportsReasoning.value = typeof sr === 'boolean' ? sr : null
    capabilityBudgetRange.value = br || {}
    capabilitySupportsSearch.value = typeof ss === 'boolean' ? ss : null
    capabilitySearchDefaults.value = sd || null
    capabilitySupportsEffort.value = typeof se === 'boolean' ? se : null
    capabilityEffortDefault.value = ed
    capabilitySupportsVerbosity.value = typeof sv === 'boolean' ? sv : null
    capabilityVerbosityDefault.value = vd
  } catch {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsSearch.value = null
    capabilitySearchDefaults.value = null
    capabilitySupportsEffort.value = null
    capabilityEffortDefault.value = undefined
    capabilitySupportsVerbosity.value = null
    capabilityVerbosityDefault.value = undefined
  }
}

watch(
  () => [props.providerId, props.modelId, props.open],
  async () => {
    if (props.open) await fetchCapabilities()
  },
  { immediate: true }
)

const showSearchConfig = computed(() => capabilitySupportsSearch.value === true)

const hasForcedSearchOption = computed(() => capabilitySearchDefaults.value?.forced !== undefined)
const hasSearchStrategyOption = computed(
  () => capabilitySearchDefaults.value?.strategy !== undefined
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
  if (isGeminiProvider.value && value === -1) {
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
