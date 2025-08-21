<template>
  <section class="w-full h-full">
    <div class="w-full h-full p-2 flex flex-col gap-2 overflow-y-auto">
      <!-- 认证方式选择 -->
      <div class="flex flex-col items-start p-2 gap-2">
        <Label class="flex-1 cursor-pointer">{{ t('settings.provider.authMethod') }}</Label>
        <Select
          v-model="authMethod"
          @update:model-value="(value: string) => switchAuthMethod(value as 'apikey' | 'oauth')"
        >
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="t('settings.provider.authMethodPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apikey">
              <div class="flex items-center gap-2">
                <Icon icon="lucide:key" class="w-4 h-4" />
                <span>{{ t('settings.provider.apiKeyLabel') }}</span>
              </div>
            </SelectItem>
            <SelectItem value="oauth">
              <div class="flex items-center gap-2">
                <Icon icon="lucide:shield-check" class="w-4 h-4" />
                <span>OAuth</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- API Key 认证方式 -->
      <div v-if="authMethod === 'apikey'" class="flex flex-col items-start p-2 gap-2">
        <div class="flex justify-between items-center w-full">
          <Label :for="`${provider.id}-url`" class="flex-1 cursor-pointer">{{
            t('settings.provider.apiUrlLabel')
          }}</Label>
        </div>
        <Input
          :id="`${provider.id}-url`"
          v-model="apiHost"
          :placeholder="t('settings.provider.urlPlaceholder')"
          @blur="handleApiHostChange(String($event.target.value))"
          @keyup.enter="handleApiHostChange(apiHost)"
        />
        <div class="text-xs text-muted-foreground">
          {{
            t('settings.provider.urlFormat', {
              defaultUrl: 'https://api.anthropic.com'
            })
          }}
        </div>

        <Label :for="`${provider.id}-apikey`" class="flex-1 cursor-pointer">{{
          t('settings.provider.apiKeyLabel')
        }}</Label>
        <div class="relative w-full">
          <Input
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
            size="xs"
            class="text-xs text-normal rounded-lg"
            @click="openModelCheckDialog"
          >
            <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />
            {{ t('settings.provider.verifyKey') }}
          </Button>
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.provider.anthropicApiKeyTip') }}
        </div>
      </div>

      <!-- OAuth 认证方式 -->
      <div v-else-if="authMethod === 'oauth'" class="flex flex-col items-start p-2 gap-2">
        <!-- 如果已经有OAuth Token -->
        <div v-if="hasOAuthToken" class="w-full space-y-2">
          <div
            class="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800"
          >
            <Icon icon="lucide:check-circle" class="w-4 h-4 text-green-600 dark:text-green-400" />
            <span class="text-sm text-green-700 dark:text-green-300">
              {{ t('settings.provider.anthropicConnected') }}
            </span>
          </div>

          <!-- OAuth 模式下的操作按钮 -->
          <div class="flex flex-row gap-2">
            <Button
              variant="outline"
              size="xs"
              class="text-xs text-normal rounded-lg"
              @click="validateOAuthConnection"
            >
              <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />
              {{ t('settings.provider.verifyConnection') }}
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="text-xs text-normal rounded-lg"
              @click="openModelCheckDialog"
            >
              <Icon icon="lucide:list" class="w-4 h-4 text-muted-foreground" />
              {{ t('settings.provider.manageModels') }}
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="text-xs text-normal rounded-lg text-destructive"
              @click="disconnectOAuth"
            >
              <Icon icon="lucide:unlink" class="w-4 h-4 text-destructive" />
              {{ t('settings.provider.disconnect') }}
            </Button>
          </div>

          <!-- OAuth 认证说明信息 -->
          <div class="text-xs text-muted-foreground">
            {{ t('settings.provider.anthropicOAuthActiveTip') }}
          </div>
        </div>

        <!-- 如果没有OAuth Token -->
        <div v-else class="w-full space-y-2">
          <!-- 等待输入code状态 -->
          <div v-if="waitingForCode" class="space-y-3">
            <div
              class="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800"
            >
              <Icon icon="lucide:external-link" class="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span class="text-sm text-blue-700 dark:text-blue-300">
                {{ t('settings.provider.anthropicBrowserOpened') }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground">
              {{ t('settings.provider.anthropicCodeInstruction') }}
            </div>
          </div>

          <!-- 未开始OAuth状态 -->
          <div v-else>
            <!-- 提示和按钮在同一行 -->
            <div
              class="flex items-center gap-3 p-2 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800"
            >
              <div class="flex items-center gap-2 flex-1">
                <Icon icon="lucide:info" class="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span class="text-sm text-yellow-700 dark:text-yellow-300">
                  {{ t('settings.provider.anthropicNotConnected') }}
                </span>
              </div>
              <Button variant="default" size="sm" :disabled="isLoggingIn" @click="startOAuthLogin">
                <Icon
                  :icon="isLoggingIn ? 'lucide:loader-2' : 'lucide:lock'"
                  :class="['w-4 h-4 mr-2', { 'animate-spin': isLoggingIn }]"
                />
                {{
                  isLoggingIn ? t('settings.provider.loggingIn') : t('settings.provider.oauthLogin')
                }}
              </Button>
            </div>
            <!-- 提示文字 -->
            <div class="text-xs text-muted-foreground mt-2">
              {{ t('settings.provider.anthropicOAuthTip') }}
            </div>
            <div class="text-xs text-muted-foreground mt-1 opacity-75">
              {{ t('settings.provider.anthropicOAuthFlowTip') }}
            </div>
          </div>
        </div>

        <!-- 验证结果提示 -->
        <div v-if="validationResult" class="w-full">
          <div
            :class="[
              'flex items-center gap-2 p-2 rounded-lg border',
              validationResult.success
                ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
            ]"
          >
            <Icon
              :icon="validationResult.success ? 'lucide:check-circle' : 'lucide:x-circle'"
              :class="[
                'w-4 h-4',
                validationResult.success
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              ]"
            />
            <span
              :class="[
                'text-sm',
                validationResult.success
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              ]"
            >
              {{ validationResult.message }}
            </span>
          </div>
        </div>
      </div>

      <!-- 模型管理 -->
      <div
        v-if="(authMethod === 'apikey' && apiKey) || (authMethod === 'oauth' && hasOAuthToken)"
        class="flex flex-col items-start p-2 gap-2 w-full"
      >
        <ProviderModelManager
          class="w-full"
          :provider="provider"
          :enabled-models="enabledModels"
          :total-models-count="totalModelsCount"
          @show-model-list-dialog="showModelListDialog = true"
          @disable-all-models="handleDisableAllModels"
          @model-enabled-change="handleModelEnabledChange"
          @config-changed="handleConfigChanged"
        />
      </div>

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
              }}
            </DialogTitle>
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

      <!-- 代码输入对话框 -->
      <Dialog v-model:open="showCodeDialog">
        <DialogContent
          class="sm:max-w-md"
          @interact-outside="(e) => e.preventDefault()"
          @escape-key-down="(e) => e.preventDefault()"
        >
          <DialogHeader>
            <DialogTitle>{{ t('settings.provider.inputOAuthCode') }}</DialogTitle>
            <DialogDescription>
              {{ t('settings.provider.oauthCodeHint') }}
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-4">
            <Input
              v-model="oauthCode"
              :placeholder="t('settings.provider.oauthCodePlaceholder')"
              class="font-mono"
              @keyup.enter="submitOAuthCode"
            />
            <div v-if="codeValidationError" class="text-sm text-destructive">
              {{ codeValidationError }}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="closeCodeDialog">
              {{ t('dialog.cancel') }}
            </Button>
            <Button :disabled="!oauthCode.trim() || isSubmittingCode" @click="submitOAuthCode">
              <Icon
                v-if="isSubmittingCode"
                icon="lucide:loader-2"
                class="w-4 h-4 mr-2 animate-spin"
              />
              {{ t('dialog.confirm') }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    <ProviderDialogContainer
      v-model:show-model-list-dialog="showModelListDialog"
      :provider="provider"
      :provider-models="providerModels"
      :custom-models="customModels"
      :model-to-disable="null"
      :check-result="false"
      @model-enabled-change="handleModelEnabledChange"
    />
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted, ref, watch, onUnmounted, computed } from 'vue'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/stores/settings'
import { useModelCheckStore } from '@/stores/modelCheck'
import { usePresenter } from '@/composables/usePresenter'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import ProviderModelManager from './ProviderModelManager.vue'
import ProviderDialogContainer from './ProviderDialogContainer.vue'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  'auth-success': []
  'auth-error': [error: string]
}>()

const settingsStore = useSettingsStore()
const modelCheckStore = useModelCheckStore()
const oauthPresenter = usePresenter('oauthPresenter')

// State
const authMethod = ref<'apikey' | 'oauth'>('apikey')
const apiHost = ref(props.provider.baseUrl || '')
const apiKey = ref(props.provider.apiKey || '')
const showApiKey = ref(false)
const showCheckModelDialog = ref(false)
const showModelListDialog = ref(false)
const checkResult = ref<boolean>(false)
const isLoggingIn = ref(false)
const validationResult = ref<{ success: boolean; message: string } | null>(null)
const waitingForCode = ref(false)
const showCodeDialog = ref(false)
const oauthCode = ref('')
const codeValidationError = ref('')
const isSubmittingCode = ref(false)

// Computed
const hasOAuthToken = ref(false)
const enabledModels = computed(() => {
  const providerModels = settingsStore.enabledModels.find(
    (provider) => provider.providerId === props.provider.id
  )
  return providerModels?.models.filter((model) => model.enabled) || []
})

const totalModelsCount = computed(() => {
  const providerModels = settingsStore.allProviderModels.find(
    (provider) => provider.providerId === props.provider.id
  )
  return providerModels?.models.length || 0
})

const providerModels = computed((): RENDERER_MODEL_META[] => {
  const provider = settingsStore.allProviderModels.find((p) => p.providerId === props.provider.id)
  return provider?.models || []
})

const customModels = computed((): RENDERER_MODEL_META[] => {
  const providerCustomModels = settingsStore.customModels.find(
    (p) => p.providerId === props.provider.id
  )
  return providerCustomModels?.models || []
})

// 初始化认证方法检测
const detectAuthMethod = async () => {
  // 检查provider配置中的认证模式
  try {
    // 优先使用provider中保存的认证模式
    if (props.provider.authMode) {
      authMethod.value = props.provider.authMode
      if (authMethod.value === 'oauth') {
        hasOAuthToken.value = await oauthPresenter.hasAnthropicCredentials()
      }
    } else {
      // 回退到基于凭据检测的旧逻辑
      const hasOAuth = await oauthPresenter.hasAnthropicCredentials()
      const hasApiKey = !!(props.provider.apiKey && props.provider.apiKey.trim())

      if (hasOAuth) {
        authMethod.value = 'oauth'
        hasOAuthToken.value = true
        // 保存检测到的认证模式
        await settingsStore.updateProviderAuth(props.provider.id, 'oauth', undefined)
      } else if (hasApiKey) {
        authMethod.value = 'apikey'
        await settingsStore.updateProviderAuth(props.provider.id, 'apikey', undefined)
      } else {
        authMethod.value = 'apikey' // 默认为API Key方式
        await settingsStore.updateProviderAuth(props.provider.id, 'apikey', undefined)
      }
    }

    waitingForCode.value = false // 初始化时不应该处于等待状态
  } catch (error) {
    console.error('Failed to detect auth method:', error)
    authMethod.value = 'apikey'
    waitingForCode.value = false
  }
}

// 切换认证方式
const switchAuthMethod = async (method: 'apikey' | 'oauth') => {
  // 保存选择的认证模式
  await settingsStore.updateProviderAuth(props.provider.id, method, undefined)

  if (method === 'oauth') {
    // 检查OAuth凭据状态
    try {
      hasOAuthToken.value = await oauthPresenter.hasAnthropicCredentials()
    } catch (error) {
      console.error('Failed to check OAuth credentials:', error)
      hasOAuthToken.value = false
    }
  } else {
    // 切换到API Key模式时重置OAuth相关状态
    hasOAuthToken.value = false
    waitingForCode.value = false
    showCodeDialog.value = false
  }
}

// OAuth 登录
const startOAuthLogin = async () => {
  isLoggingIn.value = true
  validationResult.value = null

  try {
    // Start OAuth flow (opens external browser)
    await oauthPresenter.startAnthropicOAuthFlow()

    // Switch to waiting for code state and directly show code input dialog
    isLoggingIn.value = false
    waitingForCode.value = true

    // Directly show the code input dialog
    showCodeInputDialog()

    validationResult.value = {
      success: true,
      message: t('settings.provider.browserOpenedSuccess')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.provider.loginFailed')
    emit('auth-error', message)
    validationResult.value = {
      success: false,
      message
    }
    isLoggingIn.value = false
  }
}

// 显示代码输入对话框
const showCodeInputDialog = () => {
  oauthCode.value = ''
  codeValidationError.value = ''
  showCodeDialog.value = true
}

// 关闭代码输入对话框
const closeCodeDialog = () => {
  showCodeDialog.value = false
  oauthCode.value = ''
  codeValidationError.value = ''
  // 关闭dialog时也要取消OAuth流程
  cancelOAuthFlow()
}

// 提交OAuth代码
const submitOAuthCode = async () => {
  if (!oauthCode.value.trim()) {
    codeValidationError.value = t('settings.provider.codeRequired')
    return
  }

  isSubmittingCode.value = true
  codeValidationError.value = ''

  try {
    const success = await oauthPresenter.completeAnthropicOAuthWithCode(oauthCode.value.trim())

    if (success) {
      // 更新认证模式为OAuth
      await settingsStore.updateProviderAuth(props.provider.id, 'oauth', undefined)
      hasOAuthToken.value = true
      waitingForCode.value = false
      showCodeDialog.value = false
      emit('auth-success')
      validationResult.value = {
        success: true,
        message: t('settings.provider.loginSuccess')
      }
    } else {
      codeValidationError.value = t('settings.provider.invalidCode')
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('settings.provider.codeExchangeFailed')
    codeValidationError.value = message
  } finally {
    isSubmittingCode.value = false
  }
}

// 取消OAuth流程
const cancelOAuthFlow = async () => {
  try {
    await oauthPresenter.cancelAnthropicOAuthFlow()
  } catch (error) {
    console.error('Failed to cancel OAuth flow:', error)
  }

  waitingForCode.value = false
  showCodeDialog.value = false
  oauthCode.value = ''
  codeValidationError.value = ''
  validationResult.value = null
}

// 断开OAuth连接
const disconnectOAuth = async () => {
  try {
    await oauthPresenter.clearAnthropicCredentials()
    // 清除provider中的OAuth相关状态，切换回API Key模式
    await settingsStore.updateProviderAuth(props.provider.id, 'apikey', '')
    await settingsStore.updateProviderApi(props.provider.id, '', undefined)
    hasOAuthToken.value = false
    waitingForCode.value = false
    showCodeDialog.value = false
    authMethod.value = 'apikey'
    validationResult.value = {
      success: true,
      message: t('settings.provider.disconnected')
    }
  } catch (error) {
    validationResult.value = {
      success: false,
      message: error instanceof Error ? error.message : t('settings.provider.disconnectFailed')
    }
  }
}

// API URL 处理
const handleApiHostChange = async (value: string) => {
  await settingsStore.updateProviderApi(props.provider.id, undefined, value)
}

// API Key 处理
const handleApiKeyChange = async (value: string) => {
  await settingsStore.updateProviderApi(props.provider.id, value, undefined)
}

const handleApiKeyEnter = async (value: string) => {
  const inputElement = document.getElementById(`${props.provider.id}-apikey`)
  if (inputElement) {
    inputElement.blur()
  }
  await settingsStore.updateProviderApi(props.provider.id, value, undefined)
  await validateApiKey()
}

const validateApiKey = async () => {
  try {
    const resp = await settingsStore.checkProvider(props.provider.id)
    if (resp.isOk) {
      console.log('验证成功')
      checkResult.value = true
      showCheckModelDialog.value = true
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

const validateOAuthConnection = async () => {
  try {
    // 验证 OAuth 连接状态
    const resp = await settingsStore.checkProvider(props.provider.id)
    if (resp.isOk) {
      console.log('OAuth connection verified successfully')
      checkResult.value = true
      showCheckModelDialog.value = true
      validationResult.value = {
        success: true,
        message: t('settings.provider.oauthVerifySuccess')
      }
    } else {
      console.log('OAuth connection verification failed', resp.errorMsg)
      checkResult.value = false
      showCheckModelDialog.value = true
      validationResult.value = {
        success: false,
        message: resp.errorMsg || t('settings.provider.oauthVerifyFailed')
      }
    }
  } catch (error) {
    console.error('Failed to validate OAuth connection:', error)
    checkResult.value = false
    showCheckModelDialog.value = true
    validationResult.value = {
      success: false,
      message: error instanceof Error ? error.message : t('settings.provider.oauthVerifyFailed')
    }
  }
}

const openModelCheckDialog = () => {
  // 直接打开模型检查对话框
  // 验证逻辑已经分离到专门的验证按钮中
  modelCheckStore.openDialog(props.provider.id)
}

// 模型管理事件处理
const handleDisableAllModels = async () => {
  try {
    await settingsStore.disableAllModels(props.provider.id)
  } catch (error) {
    console.error('Failed to disable all models:', error)
  }
}

const handleModelEnabledChange = async (model: RENDERER_MODEL_META, enabled: boolean) => {
  try {
    await settingsStore.updateModelStatus(props.provider.id, model.id, enabled)
  } catch (error) {
    console.error('Failed to update model enabled state:', error)
  }
}

const handleConfigChanged = () => {
  // 配置变更时可以做一些额外的处理，比如刷新UI等
  console.log('Model configuration changed')
}

// 清除验证结果的定时器
let clearValidationTimer: number | null = null

const clearValidationAfterDelay = () => {
  if (clearValidationTimer) {
    clearTimeout(clearValidationTimer)
  }
  clearValidationTimer = window.setTimeout(() => {
    validationResult.value = null
  }, 5000)
}

// 生命周期
onMounted(async () => {
  await detectAuthMethod()
})

onUnmounted(() => {
  if (clearValidationTimer) {
    clearTimeout(clearValidationTimer)
  }
})

// 监听器
watch(
  () => props.provider,
  () => {
    apiHost.value = props.provider.baseUrl || ''
    apiKey.value = props.provider.apiKey || ''
    detectAuthMethod()
  },
  { immediate: true }
)

watch(validationResult, (newVal) => {
  if (newVal) {
    clearValidationAfterDelay()
  }
})
</script>
