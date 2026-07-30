<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h4 class="text-sm font-medium">{{ t('settings.rateLimit.title') }}</h4>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.rateLimit.description') }}
        </p>
      </div>
      <Switch
        :model-value="rateLimitEnabled"
        :disabled="saving"
        @update:model-value="handleEnabledChange"
      />
    </div>

    <div v-if="rateLimitEnabled" class="space-y-3">
      <div class="space-y-2">
        <Label class="text-xs font-medium">
          {{ t('settings.rateLimit.intervalLimit') }}
        </Label>
        <div class="flex items-center space-x-2">
          <Input
            v-model.number="intervalValue"
            type="number"
            min="0"
            max="3600"
            step="0.1"
            class="w-20"
            :disabled="saving"
            @blur="handleIntervalChange"
            @keyup.enter="handleIntervalChange"
          />
          <span class="text-xs text-muted-foreground">
            {{ t('settings.rateLimit.intervalUnit') }}
          </span>
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.rateLimit.intervalHelper') }}
        </div>
      </div>

      <!-- 状态显示 -->
      <div v-if="status" class="space-y-2 text-xs">
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('settings.rateLimit.lastRequestTime') }}:</span>
          <span class="font-mono">{{ formatLastRequestTime() }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('settings.rateLimit.queueLength') }}:</span>
          <span class="font-mono">{{ status.queueLength }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('settings.rateLimit.nextAllowedTime') }}:</span>
          <span class="font-mono">{{ formatNextAllowedTime() }}</span>
        </div>
      </div>
    </div>

    <InlineOperationFeedback
      v-if="!showConfirmDialog"
      :snapshot="feedback"
      :retry-label="t('common.retry')"
      @retry="retryRateLimitUpdate"
    />

    <AlertDialog :open="showConfirmDialog" @update:open="handleConfirmDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('settings.rateLimit.confirmDisableTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.rateLimit.confirmDisableMessage') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <InlineOperationFeedback
          :snapshot="feedback"
          :retry-label="t('common.retry')"
          @retry="retryRateLimitUpdate"
        />
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="saving" @click="cancelDisableRateLimit">
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction :disabled="saving" @click="confirmDisableRateLimit">
            {{ t('settings.rateLimit.confirmDisable') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { createProviderClient } from '@api/ProviderClient'
import type { LLM_PROVIDER } from '@shared/types/provider'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
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

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  configChanged: []
}>()

const { t } = useI18n()
const providerClient = createProviderClient()
const feedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: feedback } = useSurfaceFeedback(feedbackController)
const operationId = `settings.providerRateLimit.update:${nanoid(8)}`

const rateLimitEnabled = ref(props.provider.rateLimit?.enabled ?? false)
const intervalValue = ref(convertQpsToInterval(props.provider.rateLimit?.qpsLimit ?? 0.1))
const committedInterval = ref(intervalValue.value)
const showConfirmDialog = ref(false)
const retryDraft = ref<RateLimitDraft | null>(null)
const status = ref<{
  currentQps: number
  queueLength: number
  lastRequestTime?: number
} | null>(null)
const saving = computed(() => feedback.value.status === 'pending')
const draftDirty = computed(() => intervalValue.value !== committedInterval.value)
let statusRequestId = 0
let currentProviderId = props.provider.id
let statusLoading = false
let statusRefreshQueued = false
let disposed = false

type RateLimitDraft = Readonly<{
  providerId: string
  enabled: boolean
  interval: number
}>

function convertQpsToInterval(qps: number): number {
  if (!Number.isFinite(qps) || qps <= 0) return 10
  return Math.min(3600, 1 / qps)
}

function convertIntervalToQps(interval: number): number {
  return 1 / interval
}

const handleEnabledChange = async (enabled: boolean) => {
  if (saving.value || enabled === rateLimitEnabled.value) return
  const interval =
    Number.isFinite(intervalValue.value) && intervalValue.value > 0
      ? Math.min(3600, intervalValue.value)
      : committedInterval.value
  await persistRateLimit({
    providerId: props.provider.id,
    enabled,
    interval
  })
}

const handleIntervalChange = async () => {
  if (saving.value) return
  if (!Number.isFinite(intervalValue.value) || intervalValue.value <= 0) {
    showConfirmDialog.value = true
    return
  }

  const interval = Math.min(3600, intervalValue.value)
  intervalValue.value = interval
  if (interval === committedInterval.value) return
  await persistRateLimit({
    providerId: props.provider.id,
    enabled: rateLimitEnabled.value,
    interval
  })
}

const confirmDisableRateLimit = async () => {
  if (saving.value) return
  await persistRateLimit({
    providerId: props.provider.id,
    enabled: false,
    interval: committedInterval.value
  })
}

const cancelDisableRateLimit = () => {
  if (saving.value) return
  intervalValue.value = committedInterval.value
  showConfirmDialog.value = false
}

const handleConfirmDialogOpenChange = (open: boolean) => {
  if (saving.value) return
  showConfirmDialog.value = open
  if (!open) intervalValue.value = committedInterval.value
}

const persistRateLimit = async (draft: RateLimitDraft): Promise<boolean> => {
  if (saving.value) return false
  retryDraft.value = draft
  feedbackController.begin(operationId, t('common.saving'))
  try {
    await providerClient.updateProviderRateLimit(
      draft.providerId,
      draft.enabled,
      convertIntervalToQps(draft.interval)
    )
    emit('configChanged')
    feedbackController.succeed({
      code: 'settings.providerRateLimit.updated',
      title: draft.enabled ? t('common.saved') : t('settings.rateLimit.disabled')
    })
    retryDraft.value = null
    if (props.provider.id !== draft.providerId) {
      feedbackController.clearSettled()
      return false
    }
    rateLimitEnabled.value = draft.enabled
    intervalValue.value = draft.interval
    committedInterval.value = draft.interval
    showConfirmDialog.value = false
    startStatusPolling()
    void loadStatus()
    return true
  } catch (error) {
    console.error('[ProviderRateLimitConfig] Failed to update config', error)
    feedbackController.fail({
      code: 'settings.providerRateLimit.updateFailed',
      title: t('common.error.operationFailed')
    })
    if (props.provider.id !== draft.providerId) {
      feedbackController.clearSettled()
      retryDraft.value = null
      return false
    }
    rateLimitEnabled.value = props.provider.rateLimit?.enabled ?? rateLimitEnabled.value
    intervalValue.value = committedInterval.value
    return false
  }
}

const retryRateLimitUpdate = () => {
  if (retryDraft.value) void persistRateLimit(retryDraft.value)
}

const loadStatus = async () => {
  if (statusLoading) {
    statusRefreshQueued = true
    return
  }
  statusLoading = true
  const providerId = props.provider.id
  const requestId = ++statusRequestId
  try {
    const rateLimitStatus = await providerClient.getProviderRateLimitStatus(providerId)
    if (requestId !== statusRequestId || props.provider.id !== providerId) return
    status.value = {
      currentQps: rateLimitStatus.currentQps,
      queueLength: rateLimitStatus.queueLength,
      lastRequestTime: rateLimitStatus.lastRequestTime
    }
  } catch (error) {
    if (requestId !== statusRequestId || props.provider.id !== providerId) return
    console.error('[ProviderRateLimitConfig] Failed to load status', error)
  } finally {
    statusLoading = false
    if (!disposed && statusRefreshQueued) {
      statusRefreshQueued = false
      void loadStatus()
    }
  }
}

const formatLastRequestTime = () => {
  if (!status.value?.lastRequestTime || status.value.lastRequestTime === 0) {
    return t('settings.rateLimit.never')
  }
  const diff = Date.now() - status.value.lastRequestTime
  if (diff < 1000) return t('settings.rateLimit.justNow')
  if (diff < 60000) return `${Math.floor(diff / 1000)}${t('settings.rateLimit.secondsAgo')}`
  return `${Math.floor(diff / 60000)}${t('settings.rateLimit.minutesAgo')}`
}

const formatNextAllowedTime = () => {
  if (
    !rateLimitEnabled.value ||
    !status.value?.lastRequestTime ||
    status.value.lastRequestTime === 0
  ) {
    return t('settings.rateLimit.immediately')
  }

  const nextAllowedTime = status.value.lastRequestTime + intervalValue.value * 1000
  const now = Date.now()

  if (nextAllowedTime <= now) {
    return t('settings.rateLimit.immediately')
  }

  const waitTime = Math.ceil((nextAllowedTime - now) / 1000)
  return `${waitTime}${t('settings.rateLimit.secondsLater')}`
}

const handleRateLimitEvent = (data: { providerId: string }) => {
  if (data.providerId === props.provider.id) {
    void loadStatus()
  }
}

let stopRateLimitEvents: (() => void) | null = null

const { pause: pauseStatusPolling, resume: resumeStatusPolling } = useIntervalFn(
  () => {
    void loadStatus()
  },
  1000,
  { immediate: false }
)

const startStatusPolling = () => {
  if (rateLimitEnabled.value) {
    resumeStatusPolling()
  } else {
    pauseStatusPolling()
  }
}

const stopStatusPolling = () => {
  pauseStatusPolling()
}

const discardDraft = () => {
  intervalValue.value = committedInterval.value
  showConfirmDialog.value = false
  retryDraft.value = null
  if (feedback.value.status === 'error') feedbackController.clearSettled()
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: operationId,
  onDiscard: discardDraft
})
const stopLeaveRiskSync = watch(
  [saving, draftDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onMounted(() => {
  void loadStatus()
  stopRateLimitEvents = providerClient.onRateLimitEvent(handleRateLimitEvent)
  startStatusPolling()
})

onUnmounted(() => {
  disposed = true
  statusRefreshQueued = false
  statusRequestId += 1
  stopLeaveRiskSync()
  leaveGuardLease.release()
  stopStatusPolling()
  stopRateLimitEvents?.()
  stopRateLimitEvents = null
})

watch(
  () => props.provider,
  (newProvider) => {
    const providerChanged = newProvider.id !== currentProviderId
    currentProviderId = newProvider.id
    rateLimitEnabled.value = newProvider.rateLimit?.enabled ?? false
    intervalValue.value = convertQpsToInterval(newProvider.rateLimit?.qpsLimit ?? 0.1)
    committedInterval.value = intervalValue.value
    if (providerChanged) retryDraft.value = null
    if (
      providerChanged &&
      feedback.value.status !== 'pending' &&
      feedback.value.status !== 'idle'
    ) {
      feedbackController.clearSettled()
    }
    void loadStatus()
    startStatusPolling()
  },
  { deep: true }
)
</script>
