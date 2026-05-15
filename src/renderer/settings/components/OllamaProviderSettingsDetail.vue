<template>
  <section class="w-full h-full">
    <div class="w-full h-full p-2 flex flex-col gap-2 overflow-y-auto">
      <div class="flex flex-col items-start p-2 gap-2">
        <div class="flex justify-between items-center w-full">
          <Label :for="`${provider.id}-url`" class="flex-1">API URL</Label>
          <Button
            v-if="provider.custom"
            variant="destructive"
            size="sm"
            class="text-xs rounded-lg"
            @click="showDeleteProviderDialog = true"
          >
            <Icon icon="lucide:trash-2" class="w-4 h-4 mr-1" />
            {{ t('settings.provider.delete') }}
          </Button>
        </div>
        <Input
          :id="`${provider.id}-url`"
          v-model="apiHost"
          :placeholder="t('settings.provider.urlPlaceholder')"
          @blur="handleApiHostChange(String($event.target.value))"
          @keyup.enter="handleApiHostChange(apiHost)"
        />
        <div class="text-xs text-muted-foreground">
          <TooltipProvider v-if="hasDefaultBaseUrl" :delayDuration="200">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                  :aria-label="t('settings.provider.urlFormatFill')"
                  @click="fillDefaultBaseUrl"
                >
                  {{
                    t('settings.provider.urlFormat', {
                      defaultUrl: defaultBaseUrl
                    })
                  }}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {{ t('settings.provider.urlFormatFill') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span v-else>
            {{
              t('settings.provider.urlFormat', {
                defaultUrl: defaultBaseUrl
              })
            }}
          </span>
        </div>
      </div>

      <div class="flex flex-col items-start p-2 gap-2">
        <Label :for="`${provider.id}-apikey`" class="flex-1">API Key</Label>
        <div class="relative w-full">
          <Input
            data-testid="provider-api-key-input"
            :id="`${provider.id}-apikey`"
            v-model="apiKey"
            :type="showApiKey ? 'text' : 'password'"
            :placeholder="t('settings.provider.keyPlaceholder')"
            style="padding-right: 2.5rem !important"
            @blur="handleApiKeyChange(String($event.target.value))"
            @keyup.enter="handleApiKeyEnter(apiKey)"
          />
          <Button
            variant="ghost"
            size="sm"
            class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
            @click="showApiKey = !showApiKey"
          >
            <Icon
              :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'"
              class="w-4 h-4 text-muted-foreground hover:text-foreground"
            />
          </Button>
        </div>
        <div class="flex flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-normal rounded-lg"
            :disabled="!provider.enable"
            @click="openModelCheckDialog"
          >
            <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.verifyKey') }}
          </Button>
        </div>
      </div>

      <div class="flex flex-col items-start p-2 gap-2">
        <Label :for="`${provider.id}-model`" class="flex-1">
          {{ t('settings.provider.modelList') }}
        </Label>
        <div class="flex flex-row gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-normal rounded-lg"
            @click="openPullModelDialog"
          >
            <Icon icon="lucide:download" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.pullModels') }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-normal rounded-lg"
            @click="refreshModels"
          >
            <Icon icon="lucide:refresh-cw" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.refreshModels') }}
          </Button>
          <span class="text-xs text-muted-foreground">
            {{ runningModels.length }}/{{ effectiveLocalModels.length }}
            {{ t('settings.provider.modelsRunning') }}
          </span>
        </div>

        <!-- 运行中模型列表 -->
        <div class="flex flex-col w-full gap-2">
          <h3 class="text-sm font-medium text-muted-foreground">
            {{ t('settings.provider.runningModels') }}
          </h3>
          <div class="flex flex-col w-full border overflow-hidden rounded-lg">
            <div v-if="runningModels.length === 0" class="p-4 text-center text-muted-foreground">
              {{ t('settings.provider.noRunningModels') }}
            </div>
            <div
              v-for="model in runningModels"
              :key="model.name"
              class="flex flex-row items-center justify-between p-2 border-b last:border-b-0 hover:bg-accent"
            >
              <div class="flex flex-col">
                <span class="text-sm font-medium">{{ model.name }}</span>
                <span class="text-xs text-muted-foreground">{{ formatModelSize(model.size) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 本地模型列表 -->
        <div class="flex flex-col w-full gap-2 mt-2">
          <h3 class="text-sm font-medium text-muted-foreground">
            {{ t('settings.provider.localModels') }}
          </h3>
          <div class="flex flex-col w-full border overflow-hidden rounded-lg">
            <div
              v-if="displayLocalModels.length === 0"
              class="p-4 text-center text-muted-foreground"
            >
              {{ t('settings.provider.noLocalModels') }}
            </div>
            <div
              v-for="model in displayLocalModels"
              :key="model.name"
              class="border-b last:border-b-0"
            >
              <template v-if="!model.pulling">
                <ModelConfigItem
                  :model-name="model.name"
                  :model-id="model.meta?.id ?? model.name"
                  :provider-id="provider.id"
                  :type="model.type"
                  :enabled="model.enabled"
                  :vision="model.vision"
                  :function-call="model.functionCall"
                  :explicit-function-call="model.explicitFunctionCall"
                  :reasoning="model.reasoning"
                  :enable-search="model.enableSearch"
                  :supported-endpoint-types="model.meta?.supportedEndpointTypes"
                  :endpoint-type="model.meta?.endpointType"
                  :hide-enable-toggle="true"
                  @enabled-change="handleModelEnabledChange(model.name, $event)"
                  @config-changed="refreshModels"
                />
              </template>
              <template v-else>
                <div class="flex flex-row items-center justify-between p-2 hover:bg-accent">
                  <div class="flex flex-col grow">
                    <div class="flex flex-row items-center gap-1">
                      <span class="text-sm font-medium">{{ model.name }}</span>
                      <span class="text-xs text-primary-foreground bg-primary px-1 py-0.5 rounded">
                        {{ t('settings.provider.pulling') }}
                      </span>
                      <span class="w-[50px]">
                        <Progress :model-value="pullingModels.get(model.name)" class="h-1.5" />
                      </span>
                    </div>
                    <span class="text-xs text-muted-foreground">{{
                      formatModelSize(model.size)
                    }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 拉取模型对话框 -->
    <Dialog v-model:open="showPullModelDialog">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.pullModel.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.provider.dialog.pullModel.description') }}
          </DialogDescription>
        </DialogHeader>
        <div class="py-4 max-h-80 overflow-y-auto">
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="model in availableModels"
              :key="model.name"
              class="flex flex-row items-center justify-between p-2 border rounded-lg hover:bg-accent"
              :class="{ 'opacity-50': isModelLocal(model.name) }"
            >
              <div class="flex flex-col">
                <span class="text-sm font-medium">{{ model.name }}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                class="text-xs rounded-lg"
                :disabled="isModelLocal(model.name)"
                @click="pullModel(model.name)"
              >
                <Icon icon="lucide:download" class="w-3.5 h-3.5 mr-1" />
                {{ t('settings.provider.dialog.pullModel.pull') }}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showPullModelDialog = false">
            {{ t('dialog.close') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 检查模型对话框 -->
    <Dialog v-model:open="showCheckModelDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{
              t(
                checkResult
                  ? 'settings.provider.dialog.verify.success'
                  : 'settings.provider.dialog.verify.failed'
              )
            }}</DialogTitle
          >
          <DialogDescription>
            {{
              t(
                checkResult
                  ? 'settings.provider.dialog.verify.successDesc'
                  : 'settings.provider.dialog.verify.failedDesc'
              )
            }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showCheckModelDialog = false">
            {{ t('dialog.close') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showDeleteProviderDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.dialog.deleteProvider.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.provider.dialog.deleteProvider.content', { name: provider.name }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteProviderDialog = false">
            {{ t('dialog.cancel') }}
          </Button>
          <Button variant="destructive" @click="confirmDeleteProvider">
            {{ t('settings.provider.dialog.deleteProvider.confirm') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Progress } from '@shadcn/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useProviderStore } from '@/stores/providerStore'
import { useModelCheckStore } from '@/stores/modelCheck'
import { createModelClient } from '../../api/ModelClient'
import type { LLM_PROVIDER, MODEL_META, OllamaModel, RENDERER_MODEL_META } from '@shared/presenter'
import ModelConfigItem from '@/components/settings/ModelConfigItem.vue'
import { ModelType } from '@shared/model'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  'provider-configured': []
  'provider-model-enabled': []
}>()

const modelStore = useModelStore()
const ollamaStore = useOllamaStore()
const providerStore = useProviderStore()
const modelCheckStore = useModelCheckStore()
const modelClient = createModelClient()
const apiHost = ref(props.provider.baseUrl || '')
const apiKey = ref(props.provider.apiKey || '')
const showApiKey = ref(false)
const showPullModelDialog = ref(false)
const showCheckModelDialog = ref(false)
const checkResult = ref<boolean>(false)
const showDeleteProviderDialog = ref(false)
const defaultBaseUrl = 'http://127.0.0.1:11434'
const hasDefaultBaseUrl = defaultBaseUrl.length > 0

const isProviderReadyForOnboarding = (
  provider: Pick<LLM_PROVIDER, 'apiKey' | 'baseUrl' | 'custom' | 'enable'>
) => {
  if (!provider.enable) {
    return false
  }

  const hasApiKey = provider.apiKey?.trim().length > 0
  if (!hasApiKey) {
    return false
  }

  if (provider.custom) {
    return Boolean(provider.baseUrl?.trim())
  }

  return true
}

const maybeEmitProviderConfigured = (provider: LLM_PROVIDER) => {
  if (isProviderReadyForOnboarding(provider)) {
    emit('provider-configured')
  }
}

// 模型列表 - 从 settings store 获取
const runningModels = computed(() => ollamaStore.getOllamaRunningModels(props.provider.id))
const localModels = computed(() => ollamaStore.getOllamaLocalModels(props.provider.id))
const pullingModels = computed(
  () => new Map(Object.entries(ollamaStore.getOllamaPullingModels(props.provider.id)))
)
const providerCatalogModels = computed<MODEL_META[]>(
  () => modelStore.getProviderModelsQuery(props.provider.id).data.value ?? []
)
const providerModelMetas = computed<RENDERER_MODEL_META[]>(() => {
  const localModelNames = new Set(localModels.value.map((model) => model.name))
  const catalogModelNames = new Set(providerCatalogModels.value.map((model) => model.id))
  const installedModelNames = localModelNames.size > 0 ? localModelNames : catalogModelNames
  const providerEntry = modelStore.allProviderModels.find(
    (item) => item.providerId === props.provider.id
  )
  const metaMap = new Map<string, RENDERER_MODEL_META>()

  for (const model of providerEntry?.models ?? []) {
    if (installedModelNames.has(model.id)) {
      metaMap.set(model.id, model)
    }
  }

  for (const model of providerCatalogModels.value) {
    if (!installedModelNames.has(model.id) || metaMap.has(model.id)) {
      continue
    }

    metaMap.set(model.id, {
      id: model.id,
      name: model.name || model.id,
      group: model.group || 'default',
      providerId: props.provider.id,
      enabled: (model as RENDERER_MODEL_META).enabled ?? true,
      isCustom: model.isCustom ?? false,
      contextLength: model.contextLength ?? 4096,
      maxTokens: model.maxTokens ?? 2048,
      vision: model.vision ?? false,
      functionCall: model.functionCall ?? false,
      explicitFunctionCall: (model as RENDERER_MODEL_META).explicitFunctionCall,
      reasoning: model.reasoning ?? false,
      enableSearch: (model as RENDERER_MODEL_META).enableSearch ?? false,
      type: (model.type ?? ModelType.Chat) as ModelType,
      supportedEndpointTypes: model.supportedEndpointTypes,
      endpointType: model.endpointType
    })
  }

  return Array.from(metaMap.values())
})
const createFallbackLocalModel = (meta: RENDERER_MODEL_META): OllamaModel => ({
  name: meta.id,
  model: meta.id,
  modified_at: new Date(),
  size: 0,
  digest: '',
  details: {
    format: '',
    family: '',
    families: [],
    parameter_size: '',
    quantization_level: ''
  },
  model_info: {
    context_length: meta.contextLength ?? 0,
    embedding_length: 0
  },
  capabilities: [
    meta.type === ModelType.Embedding ? 'embedding' : 'completion',
    ...(meta.vision ? ['vision'] : []),
    ...(meta.functionCall ? ['tools'] : []),
    ...(meta.reasoning ? ['thinking'] : [])
  ]
})
const effectiveLocalModels = computed<OllamaModel[]>(() => {
  if (localModels.value.length > 0) {
    return localModels.value
  }

  return providerCatalogModels.value.map((model) =>
    createFallbackLocalModel(
      providerModelMetas.value.find((meta) => meta.id === model.id) ?? {
        id: model.id,
        name: model.name || model.id,
        group: model.group || 'default',
        providerId: props.provider.id,
        enabled: true,
        isCustom: model.isCustom ?? false,
        contextLength: model.contextLength ?? 4096,
        maxTokens: model.maxTokens ?? 2048,
        vision: model.vision ?? false,
        functionCall: model.functionCall ?? false,
        explicitFunctionCall: (model as RENDERER_MODEL_META).explicitFunctionCall,
        reasoning: model.reasoning ?? false,
        enableSearch: (model as RENDERER_MODEL_META).enableSearch ?? false,
        type: (model.type ?? ModelType.Chat) as ModelType,
        supportedEndpointTypes: model.supportedEndpointTypes,
        endpointType: model.endpointType
      }
    )
  )
})

// 可拉取的模型（排除已有的和正在拉取的）
type PullModelCatalogItem = { name: string }
const pullModelCatalog = ref<MODEL_META[]>([])
const isPullModelCatalogLoading = ref(false)
const availableModels = computed<PullModelCatalogItem[]>(() => {
  const localModelNames = new Set(effectiveLocalModels.value.map((model) => model.name))
  const pullingModelNames = new Set(Array.from(pullingModels.value.keys()))
  const seenModelNames = new Set<string>()

  return pullModelCatalog.value
    .map((model) => model.id || model.name)
    .filter((modelName): modelName is string => Boolean(modelName))
    .filter((modelName) => {
      if (seenModelNames.has(modelName)) return false
      seenModelNames.add(modelName)
      return !localModelNames.has(modelName) && !pullingModelNames.has(modelName)
    })
    .map((modelName) => ({ name: modelName }))
})

// 显示的本地模型（包括正在拉取的）
const displayLocalModels = computed(() => {
  const metaMap = new Map<string, RENDERER_MODEL_META & { ollamaModel?: any }>(
    providerModelMetas.value.map((meta) => [
      meta.id,
      meta as RENDERER_MODEL_META & { ollamaModel?: any }
    ])
  )

  const models = effectiveLocalModels.value.map((model: any) => {
    const meta = metaMap.get(model.name)
    const capabilitySources: string[] = []
    if (Array.isArray(model?.capabilities)) {
      capabilitySources.push(...model.capabilities)
    }
    if (meta?.ollamaModel && Array.isArray(meta.ollamaModel?.capabilities)) {
      capabilitySources.push(...(meta.ollamaModel.capabilities as string[]))
    }
    const capabilitySet = new Set(capabilitySources)

    const resolvedType =
      meta?.type ?? (capabilitySet.has('embedding') ? ModelType.Embedding : ModelType.Chat)

    return {
      ...model,
      meta,
      pulling: pullingModels.value.has(model.name),
      progress: pullingModels.value.get(model.name) || 0,
      enabled: meta?.enabled ?? true,
      vision: meta?.vision ?? capabilitySet.has('vision'),
      functionCall: meta?.functionCall ?? capabilitySet.has('tools'),
      explicitFunctionCall:
        meta?.explicitFunctionCall ?? (capabilitySet.has('tools') ? true : undefined),
      reasoning: meta?.reasoning ?? capabilitySet.has('thinking'),
      enableSearch: meta?.enableSearch ?? false,
      type: resolvedType
    }
  })

  for (const [modelName, progress] of pullingModels.value.entries()) {
    if (!models.some((m: any) => m.name === modelName)) {
      const meta = metaMap.get(modelName)
      const capabilitySources: string[] = []
      if (meta?.ollamaModel && Array.isArray(meta.ollamaModel?.capabilities)) {
        capabilitySources.push(...(meta.ollamaModel.capabilities as string[]))
      }
      const capabilitySet = new Set(capabilitySources)

      const resolvedType =
        meta?.type ?? (capabilitySet.has('embedding') ? ModelType.Embedding : ModelType.Chat)

      models.unshift({
        name: modelName,
        model: modelName,
        modified_at: new Date(),
        size: 0,
        digest: '',
        details: {
          format: '',
          family: '',
          families: [],
          parameter_size: '',
          quantization_level: ''
        },
        model_info: {
          context_length: meta?.contextLength ?? 0,
          embedding_length: 0
        },
        capabilities: [],
        pulling: true,
        progress,
        meta,
        enabled: meta?.enabled ?? true,
        vision: meta?.vision ?? capabilitySet.has('vision'),
        functionCall: meta?.functionCall ?? capabilitySet.has('tools'),
        explicitFunctionCall:
          meta?.explicitFunctionCall ?? (capabilitySet.has('tools') ? true : undefined),
        reasoning: meta?.reasoning ?? capabilitySet.has('thinking'),
        enableSearch: meta?.enableSearch ?? false,
        type: resolvedType
      })
    }
  }

  return models.sort((a: any, b: any) => {
    if (a.pulling && !b.pulling) return -1
    if (!a.pulling && b.pulling) return 1
    return a.name.localeCompare(b.name)
  })
})

// 初始化
onMounted(() => {
  void ensureModelsReady()
})

const ensureModelsReady = async () => {
  await ollamaStore.ensureProviderReady(props.provider.id)
}

const loadPullModelCatalog = async () => {
  if (isPullModelCatalogLoading.value) {
    return
  }

  isPullModelCatalogLoading.value = true
  try {
    const models = await modelClient.getDbProviderModels(props.provider.id)
    pullModelCatalog.value = models
  } catch {
    pullModelCatalog.value = []
  } finally {
    isPullModelCatalogLoading.value = false
  }
}

const openPullModelDialog = () => {
  showPullModelDialog.value = true
  void loadPullModelCatalog()
}

// 刷新模型列表 - 使用 settings store
const refreshModels = async () => {
  await ollamaStore.refreshOllamaModels(props.provider.id)
}

// 拉取模型 - 使用 settings store
const pullModel = async (modelName: string) => {
  try {
    // 开始拉取
    const success = await ollamaStore.pullOllamaModel(props.provider.id, modelName)

    // 成功开始拉取后关闭对话框
    if (success) {
      showPullModelDialog.value = false
    }
  } catch (error) {
    console.error(`Failed to pull model ${modelName}:`, error)
  }
}

const handleModelEnabledChange = async (modelName: string, enabled: boolean) => {
  try {
    await modelStore.updateModelStatus(props.provider.id, modelName, enabled)
    if (enabled) {
      emit('provider-model-enabled')
    }
  } catch (error) {
    console.error(`Failed to update model status for ${modelName}:`, error)
  }
}

// 工具函数
const formatModelSize = (sizeInBytes: number): string => {
  if (!sizeInBytes) return ''

  const GB = 1024 * 1024 * 1024
  if (sizeInBytes >= GB) {
    return `${(sizeInBytes / GB).toFixed(2)} GB`
  }

  const MB = 1024 * 1024
  if (sizeInBytes >= MB) {
    return `${(sizeInBytes / MB).toFixed(2)} MB`
  }

  const KB = 1024
  return `${(sizeInBytes / KB).toFixed(2)} KB`
}

// 使用 settings store 的辅助函数
const isModelLocal = (modelName: string): boolean => {
  return (
    ollamaStore.isOllamaModelLocal(props.provider.id, modelName) ||
    providerModelMetas.value.some((meta) => meta.id === modelName)
  )
}

// API URL 处理
const handleApiHostChange = async (value: string) => {
  const result = await providerStore.updateProviderApi(props.provider.id, undefined, value)
  maybeEmitProviderConfigured(result.updated as LLM_PROVIDER)
}

const fillDefaultBaseUrl = async () => {
  if (!hasDefaultBaseUrl) return
  apiHost.value = defaultBaseUrl
  await handleApiHostChange(defaultBaseUrl)
}

// API Key 处理
const handleApiKeyChange = async (value: string) => {
  const result = await providerStore.updateProviderApi(props.provider.id, value, undefined)
  maybeEmitProviderConfigured(result.updated as LLM_PROVIDER)
}

const handleApiKeyEnter = async (value: string) => {
  const inputElement = document.getElementById(`${props.provider.id}-apikey`)
  if (inputElement) {
    inputElement.blur()
  }
  const result = await providerStore.updateProviderApi(props.provider.id, value, undefined)
  maybeEmitProviderConfigured(result.updated as LLM_PROVIDER)
  await validateApiKey()
}

const validateApiKey = async () => {
  if (!props.provider.enable) {
    return
  }

  try {
    const resp = await providerStore.checkProvider(props.provider.id)
    if (resp.isOk) {
      console.log('验证成功')
      checkResult.value = true
      showCheckModelDialog.value = true
      // 验证成功后刷新模型列表
      await refreshModels()
    } else {
      console.log('验证失败', resp.errorMsg)
      checkResult.value = false
      showCheckModelDialog.value = true
    }
  } catch (error) {
    console.error('Failed to validate API key:', error)
    checkResult.value = false
    showCheckModelDialog.value = true
  }
}

const openModelCheckDialog = () => {
  if (!props.provider.enable) {
    return
  }

  modelCheckStore.openDialog(props.provider.id)
}

const confirmDeleteProvider = async () => {
  try {
    await providerStore.removeProvider(props.provider.id)
    showDeleteProviderDialog.value = false
  } catch (error) {
    console.error('Failed to delete provider:', error)
  }
}

// 监听 provider 变化
watch(
  () => props.provider,
  () => {
    apiHost.value = props.provider.baseUrl || ''
    apiKey.value = props.provider.apiKey || ''
    void ensureModelsReady()
  }
)
</script>
