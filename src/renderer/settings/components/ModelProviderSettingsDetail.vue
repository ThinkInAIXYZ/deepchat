<template>
  <section class="w-full h-full">
    <ScrollArea class="w-full h-full px-4 flex flex-col gap-2">
      <div class="flex flex-col gap-4 px-2 py-4">
        <!-- 基础API配置 -->
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

        <Separator />

        <VertexProviderSettingsDetail
          v-if="provider.apiType === 'vertex'"
          :provider="provider as VERTEX_PROVIDER"
          @config-updated="handleConfigChanged"
          @validate-provider="validateApiKey"
        />

        <Separator v-if="provider.apiType === 'vertex'" />

        <!-- Azure特殊配置 -->
        <AzureProviderConfig
          v-if="provider.id === 'azure-openai'"
          :provider="provider"
          :initial-value="azureApiVersion"
          @api-version-change="handleAzureApiVersionChange"
        />

        <Separator v-if="provider.id === 'azure-openai'" />

        <!-- Gemini安全设置 -->
        <GeminiSafetyConfig
          v-if="provider.id === 'gemini'"
          :provider="provider"
          :initial-safety-levels="geminiSafetyLevelsForChild"
          @safety-setting-change="handleSafetySettingChange"
        />

        <Separator v-if="provider.id === 'gemini'" />

        <VoiceAIProviderConfig v-if="provider.id === 'voiceai'" :provider="provider" />

        <Separator v-if="provider.id === 'voiceai'" />

        <!-- 速率限制配置 -->
        <ProviderRateLimitConfig :provider="provider" @config-changed="handleConfigChanged" />

        <Separator />

        <!-- ModelScope MCP 同步 -->
        <ModelScopeMcpSync v-if="provider.id === 'modelscope'" :provider="provider" />

        <!-- 模型管理 -->
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
import { computed, reactive, ref, watch } from 'vue'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
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
import { Separator } from '@shadcn/components/ui/separator'
import type { SafetyCategoryKey, SafetySettingValue } from '@/lib/gemini'
import VoiceAIProviderConfig from './VoiceAIProviderConfig.vue'

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

const providerStore = useProviderStore()
const modelStore = useModelStore()
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

const handleModelEnabledChange = async (
  model: RENDERER_MODEL_META,
  enabled: boolean,
  confirm: boolean = false
) => {
  if (!enabled && confirm) {
    disableModel(model)
    return
  }

  await modelStore.updateModelStatus(props.provider.id, model.id, enabled)
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
  modelCheckStore.openDialog(props.provider.id)
}

const handleAddModelSaved = () => modelStore.refreshProviderModels(props.provider.id)

// 使用 computed 确保响应性正确传递
const geminiSafetyLevelsForChild = computed(() => ({ ...geminiSafetyLevels }))
</script>
