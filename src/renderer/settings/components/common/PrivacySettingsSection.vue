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

    <div class="space-y-1 text-xs leading-5 text-muted-foreground">
      <p>{{ t('settings.common.privacyModeManualActions') }}</p>
      <p>{{ t('settings.common.privacyModeIntegrations') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Switch } from '@shadcn/components/ui/switch'
import { useToast } from '@/components/use-toast'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'

const { t } = useI18n()
const { toast } = useToast()
const uiSettingsStore = useUiSettingsStore()

const privacyModeEnabled = computed(() => uiSettingsStore.privacyModeEnabled)
const isUpdatingPrivacyMode = ref(false)
const privacyModeLabelId = 'privacy-mode-label'
const privacyModeDescriptionId = 'privacy-mode-desc'

const handlePrivacyModeChange = async (value: boolean) => {
  if (isUpdatingPrivacyMode.value) {
    return
  }

  isUpdatingPrivacyMode.value = true

  try {
    await uiSettingsStore.setPrivacyModeEnabled(value)
  } catch (error) {
    console.error('Failed to update privacy mode:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : t('common.unknownError'),
      variant: 'destructive'
    })
  } finally {
    isUpdatingPrivacyMode.value = false
  }
}
</script>
