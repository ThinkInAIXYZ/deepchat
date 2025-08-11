<template>
  <section class="w-full h-full">
    <ScrollArea class="w-full h-full p-2 flex flex-col gap-2">
      <div class="flex flex-col gap-4 p-2">
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

        <!-- Azure特殊配置 -->
        <AzureProviderConfig
          v-if="provider.id === 'azure-openai'"
          :provider="provider"
          :initial-value="azureApiVersion"
          @api-version-change="handleAzureApiVersionChange"
        />

        <!-- Gemini安全设置 -->
        <GeminiSafetyConfig
          v-if="provider.id === 'gemini'"
          :provider="provider"
          :initial-safety-levels="geminiSafetyLevelsForChild"
          @safety-setting-change="handleSafetySettingChange"
        />

        <!-- 速率限制配置 -->
        <ProviderRateLimitConfig :provider="provider" @config-changed="handleConfigChanged" />

        <!-- ModelScope MCP 同步 -->
        <ModelScopeMcpSync v-if="provider.id === 'modelscope'" :provider="provider" />

        <!-- 模型管理 -->
        <ProviderModelManager
          :provider="provider"
          :enabled-models="enabledModels"
          :total-models-count="providerModels.length + customModels.length"
          @show-model-list-dialog="showModelListDialog = true"
          @disable-all-models="disableAllModelsConfirm"
          @model-enabled-change="handleModelEnabledChange"
          @config-changed="handleConfigChanged"
        />
      </div>
    </ScrollArea>

    <!-- 对话框容器 -->
    <ProviderDialogContainer
      v-model:show-confirm-dialog="showConfirmDialog"
      v-model:show-model-list-dialog="showModelListDialog"
      v-model:show-check-model-dialog="showCheckModelDialog"
      v-model:show-disable-all-confirm-dialog="showDisableAllConfirmDialog"
      v-model:show-delete-provider-dialog="showDeleteProviderDialog"
      :provider="provider"
      :provider-models="providerModels"
      :custom-models="customModels"
      :model-to-disable="modelToDisable"
      :check-result="checkResult"
      @confirm-disable-model="confirmDisable"
      @model-enabled-change="handleModelEnabledChange"
      @confirm-disable-all-models="confirmDisableAll"
      @confirm-delete-provider="confirmDeleteProvider"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, reactive } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import { ScrollArea } from '@/components/ui/scroll-area'
import ProviderApiConfig from './ProviderApiConfig.vue'
import AzureProviderConfig from './AzureProviderConfig.vue'
import GeminiSafetyConfig from './GeminiSafetyConfig.vue'
import ProviderRateLimitConfig from './ProviderRateLimitConfig.vue'
import ModelScopeMcpSync from './ModelScopeMcpSync.vue'
import ProviderModelManager from './ProviderModelManager.vue'
import ProviderDialogContainer from './ProviderDialogContainer.vue'
import { useModelCheckStore } from '@/stores/modelCheck'
import { levelToValueMap, safetyCategories } from '@/lib/gemini'
import type { SafetyCategoryKey, SafetySettingValue } from '@/lib/gemini'
import { useThrottleFn } from '@vueuse/core'

interface ProviderWebsites {
  official: string
  apiKey: string
  docs: string
  models: string
  defaultBaseUrl: string
}

// Types are imported from @/lib/gemini

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

const settingsStore = useSettingsStore()
const modelCheckStore = useModelCheckStore()
const apiKey = ref(props.provider.apiKey || '')
const apiHost = ref(props.provider.baseUrl || '')
const azureApiVersion = ref('')
const geminiSafetyLevels = reactive<Record<string, number>>({})

const providerModels = ref<RENDERER_MODEL_META[]>([])
const customModels = ref<RENDERER_MODEL_META[]>([])

const modelToDisable = ref<RENDERER_MODEL_META | null>(null)
const showConfirmDialog = ref(false)
const showModelListDialog = ref(false)
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

const providerWebsites = computed<ProviderWebsites | undefined>(() => {
  const providerConfig = settingsStore.defaultProviders.find((provider) => {
    return provider.id === props.provider.id
  })
  if (providerConfig && providerConfig.websites) {
    return providerConfig.websites as ProviderWebsites
  }
  return undefined
})

const validateApiKey = async () => {
  try {
    const resp = await settingsStore.checkProvider(props.provider.id)
    if (resp.isOk) {
      console.log('验证成功')
      checkResult.value = true
      showCheckModelDialog.value = true
      // 验证成功后刷新当前provider的模型列表
      await settingsStore.refreshProviderModels(props.provider.id)
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

// Original initData implementation without debouncing
const _initData = async () => {
  console.log('initData for provider:', props.provider.id)
  const providerData = settingsStore.allProviderModels.find(
    (p) => p.providerId === props.provider.id
  )
  if (providerData) {
    providerModels.value = providerData.models
  } else {
    providerModels.value = [] // Reset if provider data not found
  }
  const customModelData = settingsStore.customModels.find((p) => p.providerId === props.provider.id)
  if (customModelData) {
    customModels.value = customModelData.models
  } else {
    customModels.value = [] // Reset if custom data not found
  }

  // Fetch Azure API Version if applicable
  if (props.provider.id === 'azure-openai') {
    try {
      azureApiVersion.value = await settingsStore.getAzureApiVersion()
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
        const savedValue = (await settingsStore.getGeminiSafety(categoryKey)) as
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

// Debounced version of initData to reduce frequent calls within 1 second
// Ensures the final call is always executed
const initData = useThrottleFn(_initData, 1000, true, true)

// Immediate version for scenarios that require instant initialization
const initDataImmediate = _initData

// Flag to track if this is the first initialization
let isFirstInit = true

watch(
  () => props.provider,
  async () => {
    apiKey.value = props.provider.apiKey || ''
    apiHost.value = props.provider.baseUrl || ''

    // Use immediate version for first initialization, debounced version for subsequent changes
    if (isFirstInit) {
      await initDataImmediate()
      isFirstInit = false
    } else {
      initData() // Use debounced version for frequent changes
    }
  },
  { immediate: true } // Removed deep: true as provider object itself changes
)

const handleApiKeyChange = async (value: string) => {
  await settingsStore.updateProviderApi(props.provider.id, value, undefined)
}

const handleApiHostChange = async (value: string) => {
  await settingsStore.updateProviderApi(props.provider.id, undefined, value)
}

const handleModelEnabledChange = async (
  model: RENDERER_MODEL_META,
  enabled: boolean,
  comfirm: boolean = false
) => {
  if (!enabled && comfirm) {
    disableModel(model)
  } else {
    await settingsStore.updateModelStatus(props.provider.id, model.id, enabled)
  }
}

const disableModel = (model: RENDERER_MODEL_META) => {
  modelToDisable.value = model
  showConfirmDialog.value = true
}

const confirmDisable = async () => {
  if (modelToDisable.value) {
    try {
      await settingsStore.updateModelStatus(props.provider.id, modelToDisable.value.id, false)
    } catch (error) {
      console.error('Failed to disable model:', error)
    }
    showConfirmDialog.value = false
    modelToDisable.value = null
  }
}

const disableAllModelsConfirm = () => {
  showDisableAllConfirmDialog.value = true
}

const confirmDisableAll = async () => {
  try {
    await settingsStore.disableAllModels(props.provider.id)
    showDisableAllConfirmDialog.value = false
  } catch (error) {
    console.error('Failed to disable all models:', error)
  }
}

const confirmDeleteProvider = async () => {
  try {
    await settingsStore.removeProvider(props.provider.id)
    showDeleteProviderDialog.value = false
  } catch (error) {
    console.error('删除供应商失败:', error)
  }
}

watch(
  () => settingsStore.allProviderModels,
  () => {
    initData()
  },
  { deep: true }
)

watch(
  () => settingsStore.customModels,
  () => {
    initData()
  },
  { deep: true }
)

// Handler for Azure API Version change
const handleAzureApiVersionChange = async (value: string) => {
  const trimmedValue = value.trim()
  if (trimmedValue) {
    azureApiVersion.value = trimmedValue // Update local ref immediately
    await settingsStore.setAzureApiVersion(trimmedValue)
    console.log('Azure API Version updated:', trimmedValue)
  }
}

// Handler for Gemini Safety Settings change
const handleSafetySettingChange = async (key: SafetyCategoryKey, level: number) => {
  const value = levelToValueMap[level]
  if (value) {
    geminiSafetyLevels[key] = level // Update local state immediately when slider changes
    await settingsStore.setGeminiSafety(key, value)
    console.log(`Gemini safety setting for ${key} updated to level ${level} (${value})`)
  }
}

// Handler for OAuth success
const handleOAuthSuccess = async () => {
  console.log('OAuth authentication successful')
  // OAuth成功后立即刷新provider数据 (使用立即版本以快速显示结果)
  await initDataImmediate()
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
  // 模型配置变更后重新初始化数据 (使用防抖版本)
  initData()
}

const openModelCheckDialog = () => {
  modelCheckStore.openDialog(props.provider.id)
}

// 使用 computed 确保响应性正确传递
const geminiSafetyLevelsForChild = computed(() => {
  // 创建一个新的对象确保响应性
  return { ...geminiSafetyLevels }
})
</script>
