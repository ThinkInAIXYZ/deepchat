<template>
  <SettingsPageShell
    :title="t('promptSetting.title')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-prompt-page"
  >
    <template #actions>
      <InlineOperationFeedback v-if="!contextualFeedbackSurface" :snapshot="promptFeedback" />
      <Button
        variant="outline"
        size="sm"
        :disabled="pageActionsDisabled"
        @click="handleExportPrompts"
      >
        <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.export') }}
      </Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="pageActionsDisabled"
        @click="handleImportPrompts"
      >
        <Icon icon="lucide:upload" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.import') }}
      </Button>
    </template>

    <div class="flex w-full flex-col gap-4">
      <SystemPromptSettingsSection
        :feedback-controller="promptFeedbackController"
        :feedback="promptFeedback"
        :blocked="feedbackOwner === 'custom'"
        @dirty-change="systemPromptDirty = $event"
        @feedback-surface="systemFeedbackSurface = $event"
      />
      <Separator />
      <CustomPromptSettingsSection
        ref="customPromptSection"
        :feedback-controller="promptFeedbackController"
        :feedback="promptFeedback"
        :blocked="systemPromptDirty || feedbackOwner === 'system'"
        @feedback-surface="customFeedbackSurface = $event"
        @ready-change="customPromptsReady = $event"
      />
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Separator } from '@shadcn/components/ui/separator'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
import SystemPromptSettingsSection from './prompt/SystemPromptSettingsSection.vue'
import CustomPromptSettingsSection from './prompt/CustomPromptSettingsSection.vue'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const { t } = useI18n()
const promptFeedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: promptFeedback } = useSurfaceFeedback(promptFeedbackController)
const operationPending = computed(() => promptFeedback.value.status === 'pending')
const systemPromptDirty = ref(false)
const customPromptsReady = ref(false)
const systemFeedbackSurface = ref(false)
const customFeedbackSurface = ref(false)
const contextualFeedbackSurface = computed(
  () => systemFeedbackSurface.value || customFeedbackSurface.value
)
const feedbackOwner = computed<'system' | 'custom' | undefined>(() => {
  if (promptFeedback.value.status !== 'error') return undefined
  if (promptFeedback.value.operationId.startsWith('settings.systemPrompts.')) return 'system'
  if (promptFeedback.value.operationId.startsWith('settings.prompts.')) return 'custom'
  return undefined
})
const pageActionsDisabled = computed(
  () =>
    operationPending.value ||
    systemPromptDirty.value ||
    !customPromptsReady.value ||
    feedbackOwner.value === 'system'
)
const customPromptSection = ref<InstanceType<typeof CustomPromptSettingsSection> | null>(null)

const handleImportPrompts = () => {
  customPromptSection.value?.importPrompts()
}

const handleExportPrompts = () => {
  customPromptSection.value?.exportPrompts()
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings.prompts.operation',
  onDiscard: () => undefined
})
const stopLeaveRiskSync = watch(
  operationPending,
  (pending) => {
    leaveGuardLease.setRisk(pending ? 'busy' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
