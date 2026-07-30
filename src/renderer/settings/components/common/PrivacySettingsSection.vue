<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/70 p-4">
    <div class="flex items-start gap-3">
      <div class="flex min-w-0 flex-1 items-start gap-2">
        <Icon icon="lucide:shield" class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <div :id="privacyModeLabelId" class="text-sm font-medium">
            {{ t('settings.common.privacyMode') }}
          </div>
          <p :id="privacyModeDescriptionId" class="mt-1 text-xs leading-5 text-muted-foreground">
            {{ t('settings.common.privacyModeDescription') }}
          </p>
        </div>
      </div>
      <Switch
        id="privacy-mode-switch"
        data-testid="privacy-mode-switch"
        :disabled="isUpdatingPrivacyMode"
        :model-value="privacyModeEnabled"
        :aria-labelledby="privacyModeLabelId"
        :aria-describedby="privacyModeDescriptionId"
        @update:model-value="handlePrivacyModeChange"
      />
    </div>

    <ul class="list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
      <li>{{ t('settings.common.privacyModeAutoUpdate') }}</li>
      <li>{{ t('settings.common.privacyModeProviderDb') }}</li>
      <li>{{ t('settings.common.privacyModeAcpRegistry') }}</li>
      <li>{{ t('settings.common.privacyModeNpmRegistry') }}</li>
    </ul>

    <InlineOperationFeedback
      :snapshot="privacyFeedback"
      :retry-label="t('common.retry')"
      @retry="retryPrivacyModeChange"
    />

    <div class="space-y-1 text-xs leading-5 text-muted-foreground">
      <p>{{ t('settings.common.privacyModeManualActions') }}</p>
      <p>{{ t('settings.common.privacyModeIntegrations') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { Switch } from '@shadcn/components/ui/switch'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()
const privacyFeedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: privacyFeedback } = useSurfaceFeedback(privacyFeedbackController)
const privacyOperationId = `settings.privacy.update:${nanoid(8)}`

const privacyModeEnabled = computed(() => uiSettingsStore.privacyModeEnabled)
const isUpdatingPrivacyMode = computed(() => privacyFeedback.value.status === 'pending')
const retryValue = ref<boolean | null>(null)
const privacyModeLabelId = 'privacy-mode-label'
const privacyModeDescriptionId = 'privacy-mode-desc'

const handlePrivacyModeChange = async (value: boolean) => {
  if (isUpdatingPrivacyMode.value) {
    return
  }

  retryValue.value = value
  privacyFeedbackController.begin(privacyOperationId, t('common.saving'))
  try {
    await uiSettingsStore.setPrivacyModeEnabled(value)
    retryValue.value = null
    privacyFeedbackController.succeed({
      code: 'settings.privacy.updated',
      title: t('common.saved')
    })
  } catch (error) {
    console.error('[PrivacySettingsSection] Failed to update privacy mode', error)
    privacyFeedbackController.fail({
      code: 'settings.privacy.updateFailed',
      title: t('common.error.operationFailed')
    })
  }
}

const retryPrivacyModeChange = () => {
  if (retryValue.value !== null) void handlePrivacyModeChange(retryValue.value)
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: privacyOperationId,
  onDiscard: () => undefined
})
const stopLeaveRiskSync = watch(
  isUpdatingPrivacyMode,
  (busy) => leaveGuardLease.setRisk(busy ? 'busy' : 'clean'),
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
