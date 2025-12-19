<template>
  <div class="flex flex-col items-start gap-2">
    <Label class="flex-1 cursor-pointer">
      {{ t('settings.provider.githubCopilotAuth') }}
    </Label>

    <div class="w-full space-y-1">
      <Label :for="`${provider.id}-copilot-client-id`" class="text-xs text-muted-foreground">
        {{ t('settings.provider.githubCopilotClientId') }}
      </Label>
      <Input
        :id="`${provider.id}-copilot-client-id`"
        :model-value="copilotClientId"
        :placeholder="t('settings.provider.githubCopilotClientId')"
        @update:model-value="copilotClientId = String($event)"
        @blur="handleClientIdBlur"
        @keyup.enter="saveClientId(copilotClientId)"
      />
      <div class="text-xs text-muted-foreground">
        {{ t('settings.provider.githubCopilotClientIdHint') }}
      </div>
    </div>

    <!-- 如果已经有Token -->
    <div v-if="hasToken" class="w-full space-y-2">
      <div
        class="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800"
      >
        <Icon icon="lucide:check-circle" class="w-4 h-4 text-green-600 dark:text-green-400" />
        <span class="text-sm text-green-700 dark:text-green-300">
          {{ t('settings.provider.githubCopilotConnected') }}
        </span>
      </div>
      <div class="flex flex-row gap-2">
        <Button
          variant="outline"
          size="sm"
          class="text-xs text-normal rounded-lg"
          @click="openModelCheckDialog"
        >
          <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />
          {{ t('settings.provider.verifyKey') }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="text-xs text-normal rounded-lg text-destructive"
          @click="disconnect"
        >
          <Icon icon="lucide:unlink" class="w-4 h-4 text-destructive" />
          {{ t('settings.provider.disconnect') }}
        </Button>
      </div>
    </div>

    <!-- 如果没有Token -->
    <div v-else class="w-full space-y-2">
      <div
        class="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800"
      >
        <Icon icon="lucide:info" class="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
        <span class="text-sm text-yellow-700 dark:text-yellow-300">
          {{ t('settings.provider.githubCopilotNotConnected') }}
        </span>
      </div>
      <Button
        variant="default"
        size="sm"
        class="w-full"
        :disabled="isLoggingIn"
        @click="startDeviceFlowLogin"
      >
        <Icon
          :icon="isLoggingIn ? 'lucide:loader-2' : 'lucide:smartphone'"
          :class="['w-4 h-4 mr-2', { 'animate-spin': isLoggingIn }]"
        />
        {{ isLoggingIn ? t('settings.provider.loggingIn') : 'Device Flow 登录 (推荐)' }}
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-full"
        :disabled="isLoggingIn"
        @click="startOAuthLogin"
      >
        <Icon
          :icon="isLoggingIn ? 'lucide:loader-2' : 'lucide:github'"
          :class="['w-4 h-4 mr-2', { 'animate-spin': isLoggingIn }]"
        />
        {{ isLoggingIn ? t('settings.provider.loggingIn') : '传统 OAuth 登录' }}
      </Button>
      <div class="text-xs text-muted-foreground">
        {{ t('settings.provider.githubCopilotLoginTip') }}
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
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { useProviderStore } from '@/stores/providerStore'
import type { LLM_PROVIDER } from '@shared/presenter'
import { useModelCheckStore } from '@/stores/modelCheck'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  'auth-success': []
  'auth-error': [error: string]
}>()

const oauthPresenter = usePresenter('oauthPresenter')
const providerStore = useProviderStore()
const modelCheckStore = useModelCheckStore()

const isLoggingIn = ref(false)
const validationResult = ref<{ success: boolean; message: string } | null>(null)
const copilotClientId = ref(props.provider.copilotClientId || '')

const hasToken = computed(() => {
  return !!(props.provider.apiKey && props.provider.apiKey.trim())
})

watch(
  () => props.provider,
  (next) => {
    copilotClientId.value = next.copilotClientId || ''
  }
)

const saveClientId = async (value: string) => {
  const next = value.trim()
  copilotClientId.value = next
  try {
    await providerStore.updateProviderConfig(props.provider.id, { copilotClientId: next })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.provider.loginFailed')
    validationResult.value = { success: false, message }
  }
}

const handleClientIdBlur = (event: FocusEvent) => {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  void saveClientId(target.value)
}

// 默认从环境变量读取，可在上方自定义 Client ID

/**
 * 开始Device Flow登录流程（推荐）
 */
const startDeviceFlowLogin = async () => {
  isLoggingIn.value = true
  validationResult.value = null

  try {
    const success = await oauthPresenter.startGitHubCopilotDeviceFlowLogin(props.provider.id)

    if (success) {
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

/**
 * 开始OAuth登录流程（传统方式）
 */
const startOAuthLogin = async () => {
  isLoggingIn.value = true
  validationResult.value = null

  try {
    const success = await oauthPresenter.startGitHubCopilotLogin(props.provider.id)

    if (success) {
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

const openModelCheckDialog = () => {
  modelCheckStore.openDialog(props.provider.id)
}

/**
 * 断开连接
 */
const disconnect = async () => {
  try {
    // 清除API Key
    await providerStore.updateProviderApi(props.provider.id, '', undefined)
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

// 监听验证结果变化，自动清除
onMounted(() => {})

onUnmounted(() => {
  if (clearValidationTimer) {
    clearTimeout(clearValidationTimer)
  }
})

// 监听验证结果变化，自动清除
watch(validationResult, (newVal) => {
  if (newVal) {
    clearValidationAfterDelay()
  }
})
</script>
