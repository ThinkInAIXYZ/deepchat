<template>
  <section class="w-full h-full">
    <ScrollArea class="w-full h-full">
      <div class="flex flex-col gap-4 p-4">
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <h2 class="truncate text-lg font-semibold">{{ t(provider.name) }}</h2>
              <p class="mt-1 truncate text-sm text-muted-foreground">
                {{ provider.baseUrl || t('settings.provider.center.noApiUrl') }}
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="outline">
                {{
                  t('settings.provider.center.enabledModels', {
                    count: enabledModels.length
                  })
                }}
              </Badge>
            </div>
          </div>
        </div>

        <Tabs default-value="connection" class="flex min-h-0 flex-1 flex-col gap-4">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="connection">
              {{ t('settings.provider.center.tabs.connection') }}
            </TabsTrigger>
            <TabsTrigger value="models">
              {{ t('settings.provider.center.tabs.models') }}
            </TabsTrigger>
            <TabsTrigger value="advanced">
              {{ t('settings.provider.center.tabs.advanced') }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" class="mt-0">
            <ProviderApiConfig
              :provider="provider"
              :provider-websites="providerWebsites"
              @api-host-change="handleApiHostChange"
              @api-key-change="handleApiKeyChange"
              @validate-key="openModelCheckDialog"
              @delete-provider="showDeleteProviderDialog = true"
              @oauth-success="handleOAuthSuccess"
              @oauth-error="handleOAuthError"
            />
          </TabsContent>

          <TabsContent value="models" class="mt-0">
            <ProviderModelManager
              :provider="provider"
              :enabled-models="enabledModels"
              :total-models-count="providerModels.length + customModels.length"
              :provider-models="providerModels"
              :custom-models="customModels"
              :is-model-list-loading="isModelListLoading"
              @custom-model-added="handleAddModelSaved"
              @disable-all-models="disableAllModelsConfirm"
              @model-enabled-change="handleModelEnabledChange"
              @config-changed="handleConfigChanged"
            />
          </TabsContent>

          <TabsContent value="advanced" class="mt-0">
            <div class="flex flex-col gap-4">
              <ProviderRateLimitConfig :provider="provider" @config-changed="handleConfigChanged" />

              <VertexProviderSettingsDetail
                v-if="provider.apiType === 'vertex'"
                :provider="provider as VERTEX_PROVIDER"
                @config-updated="handleConfigChanged"
                @validate-provider="validateApiKey"
              />

              <AzureProviderConfig
                v-if="provider.id === 'azure-openai'"
                :provider="provider"
                :initial-value="azureApiVersion"
                @api-version-change="handleAzureApiVersionChange"
              />

              <GeminiSafetyConfig
                v-if="provider.id === 'gemini'"
                :provider="provider"
                :initial-safety-levels="geminiSafetyLevelsForChild"
                @safety-setting-change="handleSafetySettingChange"
              />

              <VoiceAIProviderConfig v-if="provider.id === 'voiceai'" :provider="provider" />

              <ModelScopeMcpSync v-if="provider.id === 'modelscope'" :provider="provider" />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>

    <!-- 对话框容器 -->
    <ProviderDialogContainer
      v-model:show-confirm-dialog="showConfirmDialog"
      v-model:show-check-model-dialog="showCheckModelDialog"
      v-model:show-disable-all-confirm-dialog="showDisableAllConfirmDialog"
      v-model:show-delete-provider-dialog="showDeleteProviderDialog"
      :provider="provider"
      :model-to-disable="modelToDisable"
      :check-result="checkResult"
      @confirm-disable-model="confirmDisable"
      @confirm-disable-all-models="confirmDisableAll"
      @confirm-delete-provider="confirmDeleteProvider"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import type { LLM_PROVIDER, RENDERER_MODEL_META, VERTEX_PROVIDER } from '@shared/presenter'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import ProviderApiConfig from './ProviderApiConfig.vue'
import AzureProviderConfig from './AzureProviderConfig.vue'
import GeminiSafetyConfig from './GeminiSafetyConfig.vue'
import VertexProviderSettingsDetail from './VertexProviderSettingsDetail.vue'
import ProviderRateLimitConfig from './ProviderRateLimitConfig.vue'
import ModelScopeMcpSync from './ModelScopeMcpSync.vue'
import ProviderModelManager from './ProviderModelManager.vue'
import ProviderDialogContainer from './ProviderDialogContainer.vue'
import { useModelCheckStore } from '@/stores/modelCheck'
import { levelToValueMap, safetyCategories } from '@/lib/gemini'
import type { SafetyCategoryKey, SafetySettingValue } from '@/lib/gemini'
import VoiceAIProviderConfig from './VoiceAIProviderConfig.vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'

interface ProviderWebsites {
  official: string
  apiKey: string
  docs: string
  models: string
  defaultBaseUrl: string
}

// Value to level mapping for Gemini safety settings
const valueToLevelMap: Record<SafetySettingValue, number> = {
  BLOCK_NONE: 0,
  BLOCK_LOW_AND_ABOVE: 1,
  BLOCK_MEDIUM_AND_ABOVE: 2,
  BLOCK_ONLY_HIGH: 3,
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: 2 // Default to level 2 if unspecified
}

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const { t } = useI18n()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const uiSettingsStore = useUiSettingsStore()
const modelCheckStore = useModelCheckStore()
const azureApiVersion = ref('')
const geminiSafetyLevels = reactive<Record<string, number>>({})

const emptyModels: RENDERER_MODEL_META[] = []

const providerModels = ref<RENDERER_MODEL_META[]>([])
const customModels = ref<RENDERER_MODEL_META[]>([])
const isModelListLoading = ref(true)
const hasInitializedModelList = ref(false)

const modelToDisable = ref<RENDERER_MODEL_META | null>(null)
const showConfirmDialog = ref(false)
const showDisableAllConfirmDialog = ref(false)
const showDeleteProviderDialog = ref(false)
const enabledModels = computed(() => {
  const enabledModelsList = [
    ...customModels.value.filter((m) => m.enabled),
    ...providerModels.value.filter((m) => m.enabled)
  ]
  const uniqueModels = new Map<string, RENDERER_MODEL_META>()

  enabledModelsList.forEach((model) => {
    if (!uniqueModels.has(model.id)) {
      uniqueModels.set(model.id, model)
    }
  })

  return Array.from(uniqueModels.values())
})
const checkResult = ref<boolean>(false)
const showCheckModelDialog = ref(false)

const providerWebsites = computed<ProviderWebsites | undefined>(
  () =>
    providerStore.defaultProviders.find((provider) => provider.id === props.provider.id)
      ?.websites as ProviderWebsites | undefined
)

const providerModelsSource = computed(
  () =>
    modelStore.allProviderModels.find((p) => p.providerId === props.provider.id)?.models ??
    emptyModels
)

const customModelsSource = computed(
  () =>
    modelStore.customModels.find((p) => p.providerId === props.provider.id)?.models ?? emptyModels
)

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
      // 验证成功后刷新当前provider的模型列表
      await modelStore.refreshProviderModels(props.provider.id)
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

const syncModels = () => {
  if (!hasInitializedModelList.value) {
    isModelListLoading.value = true
  }

  providerModels.value = providerModelsSource.value
  customModels.value = customModelsSource.value

  if (!hasInitializedModelList.value) {
    hasInitializedModelList.value = true
  }
  isModelListLoading.value = false
}

watch(
  [providerModelsSource, customModelsSource],
  () => {
    syncModels()
  },
  { immediate: true }
)

const initProviderSettings = async () => {
  console.log('initData for provider:', props.provider.id)

  await providerStore.ensureDefaultProvidersReady()

  // Fetch Azure API Version if applicable
  if (props.provider.id === 'azure-openai') {
    try {
      azureApiVersion.value = await providerStore.getAzureApiVersion()
      console.log('Azure API Version fetched:', azureApiVersion.value)
    } catch (error) {
      console.error('Failed to fetch Azure API Version:', error)
      azureApiVersion.value = '2024-02-01' // Default value on error
    }
  }

  // Fetch Gemini Safety Settings if applicable
  if (props.provider.id === 'gemini') {
    console.log('Fetching Gemini safety settings...')

    // 先清空现有数据
    Object.keys(geminiSafetyLevels).forEach((key) => {
      delete geminiSafetyLevels[key]
    })

    for (const key in safetyCategories) {
      const categoryKey = key as string
      try {
        const savedValue = (await providerStore.getGeminiSafety(categoryKey)) as
          | string
          | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
        console.log(`Fetched Gemini safety for ${categoryKey}:`, savedValue)
        geminiSafetyLevels[categoryKey] =
          valueToLevelMap[savedValue as SafetySettingValue] ??
          safetyCategories[categoryKey as SafetyCategoryKey].defaultLevel
        console.log(`Set Gemini level for ${categoryKey}:`, geminiSafetyLevels[categoryKey])
      } catch (error) {
        console.error(`Failed to fetch Gemini safety setting for ${categoryKey}:`, error)
        geminiSafetyLevels[categoryKey] =
          safetyCategories[categoryKey as SafetyCategoryKey].defaultLevel // Default on error
      }
    }

    console.log('All Gemini safety levels initialized:', JSON.stringify(geminiSafetyLevels))
  }
}

watch(
  () => props.provider.id,
  () => {
    initProviderSettings()
  },
  { immediate: true }
)

const handleApiKeyChange = (value: string) =>
  providerStore.updateProviderApi(props.provider.id, value, undefined)

const handleApiHostChange = (value: string) =>
  providerStore.updateProviderApi(props.provider.id, undefined, value)

const MODEL_TOGGLE_PERF_LOG_PREFIX = '[ModelTogglePerf]'
const getPerfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const logModelTogglePerf = (phase: string, details: Record<string, unknown>) => {
  if (!uiSettingsStore.traceDebugEnabled) {
    return
  }

  console.info(`${MODEL_TOGGLE_PERF_LOG_PREFIX} ${phase}`, details)
}

const waitForNextPaint = async () => {
  if (typeof requestAnimationFrame !== 'function') {
    return
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

const handleModelEnabledChange = async (
  model: RENDERER_MODEL_META,
  enabled: boolean,
  confirm: boolean = false
) => {
  if (!enabled && confirm) {
    disableModel(model)
    return
  }

  const interactionStart = getPerfNow()
  logModelTogglePerf('detail.click', {
    providerId: props.provider.id,
    modelId: model.id,
    enabled
  })

  await modelStore.updateModelStatus(props.provider.id, model.id, enabled)

  const storeComplete = getPerfNow()
  if (!uiSettingsStore.traceDebugEnabled) {
    return
  }

  await nextTick()
  const nextTickComplete = getPerfNow()
  await waitForNextPaint()
  const paintComplete = getPerfNow()

  logModelTogglePerf('detail.settled', {
    providerId: props.provider.id,
    modelId: model.id,
    enabled,
    storeMs: Math.round(storeComplete - interactionStart),
    nextTickMs: Math.round(nextTickComplete - storeComplete),
    paintMs: Math.round(paintComplete - nextTickComplete),
    totalMs: Math.round(paintComplete - interactionStart)
  })
}

const disableModel = (model: RENDERER_MODEL_META) => {
  modelToDisable.value = model
  showConfirmDialog.value = true
}

const confirmDisable = async () => {
  if (!modelToDisable.value) {
    return
  }

  try {
    await modelStore.updateModelStatus(props.provider.id, modelToDisable.value.id, false)
  } catch (error) {
    console.error('Failed to disable model:', error)
  }

  showConfirmDialog.value = false
  modelToDisable.value = null
}

const disableAllModelsConfirm = () => {
  showDisableAllConfirmDialog.value = true
}

const confirmDisableAll = async () => {
  try {
    await modelStore.disableAllModels(props.provider.id)
    showDisableAllConfirmDialog.value = false
  } catch (error) {
    console.error('Failed to disable all models:', error)
  }
}

const confirmDeleteProvider = async () => {
  try {
    await providerStore.removeProvider(props.provider.id)
    showDeleteProviderDialog.value = false
  } catch (error) {
    console.error('删除供应商失败:', error)
  }
}

// Handler for Azure API Version change
const handleAzureApiVersionChange = async (value: string) => {
  const trimmedValue = value.trim()
  if (trimmedValue) {
    azureApiVersion.value = trimmedValue // Update local ref immediately
    await providerStore.setAzureApiVersion(trimmedValue)
    console.log('Azure API Version updated:', trimmedValue)
  }
}

// Handler for Gemini Safety Settings change
const handleSafetySettingChange = async (key: SafetyCategoryKey, level: number) => {
  const value = levelToValueMap[level]
  if (value) {
    geminiSafetyLevels[key] = level // Update local state immediately when slider changes
    await providerStore.setGeminiSafety(key, value)
    console.log(`Gemini safety setting for ${key} updated to level ${level} (${value})`)
  }
}

// Handler for OAuth success
const handleOAuthSuccess = async () => {
  console.log('OAuth authentication successful')
  await initProviderSettings()
  syncModels()
  // 可以自动验证一次
  await validateApiKey()
}

// Handler for OAuth error
const handleOAuthError = (error: string) => {
  console.error('OAuth authentication failed:', error)
  // 可以在这里显示错误提示
}

// Handler for config changes
const handleConfigChanged = () => {
  // 模型配置变更后先刷新provider模型数据，确保能看到最新的模型能力
  return modelStore.refreshProviderModels(props.provider.id)
}

const openModelCheckDialog = () => {
  if (!props.provider.enable) {
    return
  }

  modelCheckStore.openDialog(props.provider.id)
}

const handleAddModelSaved = () => modelStore.refreshProviderModels(props.provider.id)

// 使用 computed 确保响应性正确传递
const geminiSafetyLevelsForChild = computed(() => ({ ...geminiSafetyLevels }))
</script>
