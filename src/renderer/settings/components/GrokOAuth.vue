<template>
  <div class="flex flex-col items-start gap-3">
    <Label class="flex-1">
      {{ t('settings.provider.xaiGrokAuth') }}
    </Label>

    <div :class="['w-full rounded-md border px-3 py-2', statusClass]">
      <div class="flex items-start gap-2">
        <Spinner v-if="isPending" class="mt-0.5 size-4 shrink-0" />
        <Icon v-else :icon="statusIcon" class="mt-0.5 size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium leading-5">
            {{ statusText }}
          </div>
          <div
            v-if="status.accountLabel || status.accountId"
            class="mt-1 space-y-0.5 text-xs opacity-80"
          >
            <div v-if="status.accountLabel">
              {{ status.accountLabel }}
            </div>
            <div v-if="status.accountId">
              {{ t('settings.provider.xaiGrokAccount') }}: {{ status.accountId }}
            </div>
          </div>
          <div v-if="isPending && status.userCode" class="mt-2 space-y-1 text-xs">
            <div class="font-mono text-sm font-semibold tracking-wider">
              {{ status.userCode }}
            </div>
            <a
              v-if="verificationLink"
              :href="verificationLink"
              target="_blank"
              rel="noopener noreferrer"
              class="break-all text-primary underline"
              @click.prevent="openVerificationUrl"
            >
              {{ verificationLink }}
            </a>
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
        data-testid="grok-test-connection-button"
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
        data-testid="grok-device-login-button"
        variant="default"
        size="sm"
        class="text-xs"
        :disabled="isBusy || status.state === 'disabled'"
        @click="startDeviceLogin"
      >
        <Spinner v-if="isDeviceBusy" class="size-4" data-icon="inline-start" />
        <Icon v-else icon="lucide:smartphone" class="size-4" data-icon="inline-start" />
        {{ deviceButtonText }}
      </Button>

      <Button
        v-if="isPending && verificationLink"
        data-testid="grok-open-verification-button"
        variant="outline"
        size="sm"
        class="text-xs"
        @click="openVerificationUrl"
      >
        <Icon icon="lucide:external-link" class="h-4 w-4" />
        {{ t('settings.provider.xaiGrokOpenVerification') }}
      </Button>

      <Button
        v-if="isPending"
        data-testid="grok-cancel-login-button"
        variant="outline"
        size="sm"
        class="text-xs"
        @click="cancelLogin"
      >
        <Icon icon="lucide:x" class="h-4 w-4" />
        {{ t('settings.provider.xaiGrokCancel') }}
      </Button>

      <Button
        v-if="status.authenticated"
        data-testid="grok-logout-button"
        variant="outline"
        size="sm"
        class="text-xs text-destructive"
        @click="logout"
      >
        <Icon icon="lucide:unlink" class="h-4 w-4 text-destructive" />
        {{ t('settings.provider.xaiGrokSignOut') }}
      </Button>
    </div>

    <div class="text-xs leading-5 text-muted-foreground">
      {{ t('settings.provider.xaiGrokLoginTip') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import { Button } from '@shadcn/components/ui/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import { createOAuthClient } from '@api/OAuthClient'
import { createBrowserClient } from '@api/BrowserClient'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER } from '@shared/presenter'
import type { XaiGrokAuthStatus } from '@shared/contracts/routes'

const { t } = useI18n()

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  'auth-success': []
  'auth-error': [error: string]
}>()

const signedOutStatus: XaiGrokAuthStatus = {
  state: 'signed-out',
  authenticated: false,
  storage: 'none'
}

const oauthClient = createOAuthClient()
const browserClient = createBrowserClient()
const modelCheckStore = useModelCheckStore()
const status = ref<XaiGrokAuthStatus>(signedOutStatus)
const busyAction = ref<'device' | 'cancel' | 'logout' | null>(null)
let pollTimer: number | null = null
let unsubscribeStatus: (() => void) | null = null

const isPending = computed(() => status.value.state === 'pending-device')
const isBusy = computed(() => busyAction.value !== null)
const isDeviceBusy = computed(
  () => busyAction.value === 'device' || status.value.state === 'pending-device'
)
const verificationLink = computed(
  () => status.value.verificationUriComplete || status.value.verificationUri || ''
)
const statusClass = computed(() => {
  if (status.value.authenticated) {
    return 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
  }
  if (status.value.state === 'error' || status.value.state === 'disabled') {
    return 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
  }
  if (status.value.state === 'pending-device') {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
  }
  return 'border-border bg-muted/40 text-foreground'
})
const statusIcon = computed(() => {
  if (status.value.authenticated) return 'lucide:check-circle'
  if (status.value.state === 'error' || status.value.state === 'disabled') return 'lucide:x-circle'
  return 'lucide:info'
})
const statusText = computed(() => {
  if (status.value.state === 'disabled') return t('settings.provider.xaiGrokDisabled')
  if (status.value.authenticated) return t('settings.provider.xaiGrokConnected')
  if (status.value.state === 'pending-device') return t('settings.provider.xaiGrokPendingDevice')
  if (status.value.state === 'error') return t('settings.provider.xaiGrokError')
  return t('settings.provider.xaiGrokNotConnected')
})
const deviceButtonText = computed(() => {
  if (status.value.authenticated) return t('settings.provider.xaiGrokReconnect')
  if (status.value.state === 'pending-device') return t('settings.provider.loggingIn')
  return t('settings.provider.xaiGrokSignInDevice')
})

const applyStatus = (nextStatus: XaiGrokAuthStatus, options?: { emitEvents?: boolean }) => {
  const previousStatus = status.value
  status.value = nextStatus
  if (!options?.emitEvents) {
    return
  }
  if (nextStatus.authenticated && !previousStatus.authenticated) {
    emit('auth-success')
  } else if (
    nextStatus.error &&
    nextStatus.state === 'error' &&
    (previousStatus.state !== 'error' || previousStatus.error !== nextStatus.error)
  ) {
    emit('auth-error', nextStatus.error)
  }
}

const applyError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  applyStatus(
    {
      ...status.value,
      state: 'error',
      authenticated: false,
      error: message
    },
    { emitEvents: true }
  )
}

const refreshStatus = async () => applyStatus(await oauthClient.getXaiGrokStatus())

const runAuthAction = async (
  action: 'device' | 'cancel' | 'logout',
  runner: () => Promise<XaiGrokAuthStatus>
) => {
  busyAction.value = action
  try {
    applyStatus(await runner(), { emitEvents: true })
  } catch (error) {
    applyError(error)
  } finally {
    busyAction.value = null
  }
}

const startDeviceLogin = () => runAuthAction('device', () => oauthClient.startXaiGrokDeviceLogin())

const cancelLogin = () => runAuthAction('cancel', () => oauthClient.cancelXaiGrokLogin())

const logout = () => runAuthAction('logout', () => oauthClient.logoutXaiGrok())

const openVerificationUrl = () => {
  if (verificationLink.value) {
    void browserClient.openExternal(verificationLink.value)
  }
}

const openModelCheckDialog = () => {
  modelCheckStore.openDialog(props.provider.id)
}

const stopPolling = () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

const startPolling = () => {
  stopPolling()
  pollTimer = window.setInterval(() => {
    void refreshStatus().catch(applyError)
  }, 1500)
}

watch(
  () => status.value.state,
  (state) => {
    if (state === 'pending-device') {
      startPolling()
    } else {
      stopPolling()
    }
  }
)

onMounted(() => {
  unsubscribeStatus = oauthClient.onXaiGrokStatusChanged((next) => {
    applyStatus(next, { emitEvents: true })
  })
  void refreshStatus().catch(applyError)
})

onUnmounted(() => {
  stopPolling()
  unsubscribeStatus?.()
  unsubscribeStatus = null
})
</script>
