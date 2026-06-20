<template>
  <div class="flex flex-col items-start gap-3">
    <Label class="flex-1">
      {{ t('settings.provider.openaiCodexAuth') }}
    </Label>

    <div :class="['w-full rounded-md border px-3 py-2', statusClass]">
      <div class="flex items-start gap-2">
        <Icon :icon="statusIcon" class="mt-0.5 h-4 w-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium leading-5">
            {{ statusText }}
          </div>
          <div
            v-if="status.accountLabel || status.accountId || status.planType"
            class="mt-1 space-y-0.5 text-xs opacity-80"
          >
            <div v-if="status.accountLabel">
              {{ status.accountLabel }}
            </div>
            <div v-if="status.accountId">
              {{ t('settings.provider.openaiCodexAccount') }}: {{ status.accountId }}
            </div>
            <div v-if="status.planType">
              {{ t('settings.provider.openaiCodexPlan') }}: {{ status.planType }}
            </div>
          </div>
          <div v-if="status.error" class="mt-1 text-xs opacity-90">
            {{ status.error }}
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        v-if="status.authenticated"
        data-testid="codex-test-connection-button"
        variant="outline"
        size="sm"
        class="text-xs text-normal rounded-lg"
        :disabled="!provider.enable"
        @click="openModelCheckDialog"
      >
        <Icon icon="lucide:check-check" class="h-4 w-4 text-muted-foreground" />
        {{ t('settings.provider.verifyKey') }}
      </Button>

      <Button
        data-testid="codex-browser-login-button"
        variant="default"
        size="sm"
        class="text-xs"
        :disabled="isBusy || status.state === 'disabled'"
        @click="startBrowserLogin"
      >
        <Icon
          :icon="isBrowserBusy ? 'lucide:loader-2' : 'lucide:globe'"
          :class="['h-4 w-4', { 'animate-spin': isBrowserBusy }]"
        />
        {{ browserButtonText }}
      </Button>

      <Button
        v-if="isPending"
        data-testid="codex-cancel-login-button"
        variant="outline"
        size="sm"
        class="text-xs"
        @click="cancelLogin"
      >
        <Icon icon="lucide:x" class="h-4 w-4" />
        {{ t('settings.provider.openaiCodexCancel') }}
      </Button>

      <Button
        v-if="status.authenticated"
        data-testid="codex-logout-button"
        variant="outline"
        size="sm"
        class="text-xs text-destructive"
        @click="logout"
      >
        <Icon icon="lucide:unlink" class="h-4 w-4 text-destructive" />
        {{ t('settings.provider.openaiCodexSignOut') }}
      </Button>
    </div>

    <div class="text-xs leading-5 text-muted-foreground">
      {{ t('settings.provider.openaiCodexLoginTip') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { createOAuthClient } from '@api/OAuthClient'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER } from '@shared/presenter'
import type { OpenAICodexAuthStatus } from '@shared/contracts/routes'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  'auth-success': []
  'auth-error': [error: string]
}>()

const signedOutStatus: OpenAICodexAuthStatus = {
  state: 'signed-out',
  authenticated: false,
  storage: 'none'
}

const oauthClient = createOAuthClient()
const modelCheckStore = useModelCheckStore()
const status = ref<OpenAICodexAuthStatus>(signedOutStatus)
const busyAction = ref<'browser' | 'cancel' | 'logout' | null>(null)
let pollTimer: number | null = null
let unsubscribeStatus: (() => void) | null = null

const isPending = computed(() => status.value.state === 'pending-browser')
const isBusy = computed(() => busyAction.value !== null)
const isBrowserBusy = computed(
  () => busyAction.value === 'browser' || status.value.state === 'pending-browser'
)
const statusClass = computed(() => {
  if (status.value.authenticated) {
    return 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
  }
  if (status.value.state === 'error' || status.value.state === 'disabled') {
    return 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
  }
  if (isPending.value) {
    return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200'
  }
  return 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'
})
const statusIcon = computed(() => {
  if (status.value.authenticated) {
    return 'lucide:check-circle'
  }
  if (status.value.state === 'error' || status.value.state === 'disabled') {
    return 'lucide:circle-alert'
  }
  if (isPending.value) {
    return 'lucide:loader-2'
  }
  return 'lucide:info'
})
const statusText = computed(() => {
  switch (status.value.state) {
    case 'authenticated':
      return t('settings.provider.openaiCodexConnected')
    case 'pending-browser':
      return t('settings.provider.openaiCodexPendingBrowser')
    case 'disabled':
      return t('settings.provider.openaiCodexDisabled')
    case 'error':
      return t('settings.provider.openaiCodexError')
    case 'signed-out':
    default:
      return t('settings.provider.openaiCodexNotConnected')
  }
})
const browserButtonText = computed(() =>
  isBrowserBusy.value
    ? t('settings.provider.loggingIn')
    : status.value.authenticated
      ? t('settings.provider.openaiCodexReconnect')
      : t('settings.provider.openaiCodexSignInBrowser')
)

const applyStatus = (
  nextStatus: OpenAICodexAuthStatus,
  options: {
    notify?: boolean
  } = {}
) => {
  status.value = nextStatus
  if (!options.notify) {
    return
  }

  if (nextStatus.authenticated) {
    emit('auth-success')
  } else if (nextStatus.state === 'error' && nextStatus.error) {
    emit('auth-error', nextStatus.error)
  }
}

const refreshStatus = async () => {
  applyStatus(await oauthClient.getOpenAICodexStatus())
}

const runAuthAction = async (
  action: 'browser' | 'cancel' | 'logout',
  runner: () => Promise<OpenAICodexAuthStatus>
) => {
  busyAction.value = action
  try {
    applyStatus(await runner(), { notify: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.provider.loginFailed')
    emit('auth-error', message)
    status.value = {
      state: 'error',
      authenticated: false,
      storage: status.value.storage,
      error: message
    }
  } finally {
    busyAction.value = null
  }
}

const startBrowserLogin = () =>
  runAuthAction('browser', () => oauthClient.startOpenAICodexBrowserLogin())

const cancelLogin = () => runAuthAction('cancel', () => oauthClient.cancelOpenAICodexLogin())

const logout = () => runAuthAction('logout', () => oauthClient.logoutOpenAICodex())

const openModelCheckDialog = () => {
  if (props.provider.enable) {
    modelCheckStore.openDialog(props.provider.id)
  }
}

const stopPolling = () => {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const updatePolling = () => {
  stopPolling()
  if (isPending.value) {
    pollTimer = window.setInterval(() => {
      void refreshStatus()
    }, 2000)
  }
}

onMounted(() => {
  unsubscribeStatus = oauthClient.onOpenAICodexStatusChanged(applyStatus)
  void refreshStatus()
})

onUnmounted(() => {
  stopPolling()
  unsubscribeStatus?.()
})

watch(() => status.value.state, updatePolling)
</script>
