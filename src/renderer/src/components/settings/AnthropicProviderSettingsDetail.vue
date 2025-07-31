<template>
  <section class="w-full h-full">
    <div class="w-full h-full p-2 flex flex-col gap-2 overflow-y-auto">
      <!-- 认证方式选择 -->
      <div class="flex flex-col items-start p-2 gap-2">
        <Label class="flex-1 cursor-pointer">{{ t('settings.provider.authMethod') }}</Label>
        <Select v-model="authMethod" @update:model-value="(value: string) => switchAuthMethod(value as 'apikey' | 'oauth')">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择认证方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apikey">
              <div class="flex items-center gap-2">
                <Icon icon="lucide:key" class="w-4 h-4" />
                <span>API Key</span>
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
          <Label :for="`${provider.id}-url`" class="flex-1 cursor-pointer">API URL</Label>
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

        <Label :for="`${provider.id}-apikey`" class="flex-1 cursor-pointer">API Key</Label>
        <Input
          :id="`${provider.id}-apikey`"
          v-model="apiKey"
          type="password"
          :placeholder="t('settings.provider.keyPlaceholder')"
          @blur="handleApiKeyChange(String($event.target.value))"
          @keyup.enter="handleApiKeyEnter(apiKey)"
        />
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
        </div>

        <!-- 如果没有OAuth Token -->
        <div v-else class="w-full space-y-2">
          <div
            class="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800"
          >
            <Icon icon="lucide:info" class="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span class="text-sm text-yellow-700 dark:text-yellow-300">
              {{ t('settings.provider.anthropicNotConnected') }}
            </span>
          </div>
          <Button
            variant="default"
            size="sm"
            class="w-full"
            :disabled="isLoggingIn"
            @click="startOAuthLogin"
          >
            <Icon
              :icon="isLoggingIn ? 'lucide:loader-2' : 'lucide:lock'"
              :class="['w-4 h-4 mr-2', { 'animate-spin': isLoggingIn }]"
            />
            {{ isLoggingIn ? t('settings.provider.loggingIn') : t('settings.provider.oauthLogin') }}
          </Button>
          <div class="text-xs text-muted-foreground">
            {{ t('settings.provider.anthropicOAuthTip') }}
          </div>
          <div class="text-xs text-muted-foreground mt-1 opacity-75">
            {{ t('settings.provider.anthropicOAuthFlowTip') }}
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
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="showCheckModelDialog = false">
              {{ t('dialog.close') }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted, ref, watch, onUnmounted } from 'vue'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
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
import type { LLM_PROVIDER } from '@shared/presenter'

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
const showCheckModelDialog = ref(false)
const checkResult = ref<boolean>(false)
const isLoggingIn = ref(false)
const validationResult = ref<{ success: boolean; message: string } | null>(null)

// Computed
const hasOAuthToken = ref(false)

// 初始化认证方法检测
const detectAuthMethod = async () => {
  // 检查是否有OAuth凭据
  try {
    const hasOAuth = await oauthPresenter.hasAnthropicCredentials()
    const hasApiKey = !!(props.provider.apiKey && props.provider.apiKey.trim())

    if (hasOAuth) {
      authMethod.value = 'oauth'
      hasOAuthToken.value = true
    } else if (hasApiKey) {
      authMethod.value = 'apikey'
    } else {
      authMethod.value = 'apikey' // 默认为API Key方式
    }
  } catch (error) {
    console.error('Failed to detect auth method:', error)
    authMethod.value = 'apikey'
  }
}

// 切换认证方式
const switchAuthMethod = async (method: 'apikey' | 'oauth') => {
  if (method === 'oauth') {
    // 检查OAuth凭据状态
    try {
      hasOAuthToken.value = await oauthPresenter.hasAnthropicCredentials()
    } catch (error) {
      console.error('Failed to check OAuth credentials:', error)
      hasOAuthToken.value = false
    }
  }
}

// OAuth 登录
const startOAuthLogin = async () => {
  isLoggingIn.value = true
  validationResult.value = null

  try {
    const success = await oauthPresenter.startAnthropicOAuthLogin(props.provider.id)

    if (success) {
      hasOAuthToken.value = true
      emit('auth-success')
      validationResult.value = {
        success: true,
        message: t('settings.provider.loginSuccess')
      }
    } else {
      emit('auth-error', t('settings.provider.loginFailed'))
      validationResult.value = {
        success: false,
        message: t('settings.provider.loginFailed')
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.provider.loginFailed')
    emit('auth-error', message)
    validationResult.value = {
      success: false,
      message
    }
  } finally {
    isLoggingIn.value = false
  }
}

// 断开OAuth连接
const disconnectOAuth = async () => {
  try {
    await oauthPresenter.clearAnthropicCredentials()
    // 清除provider中的apiKey
    await settingsStore.updateProviderApi(props.provider.id, '', undefined)
    hasOAuthToken.value = false
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

const openModelCheckDialog = () => {
  modelCheckStore.openDialog(props.provider.id)
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
