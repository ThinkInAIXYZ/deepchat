<template>
  <SettingsPageShell
    :title="t('promptSetting.title')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-prompt-page"
  >
    <template #actions>
      <DcButton
        variant="outline"
        size="sm"
        icon="lucide:download"
        :disabled="pageActionsDisabled"
        @click="handleExportPrompts"
      >
        {{ t('promptSetting.export') }}
      </DcButton>
      <DcButton
        variant="outline"
        size="sm"
        icon="lucide:upload"
        :disabled="pageActionsDisabled"
        @click="handleImportPrompts"
      >
        {{ t('promptSetting.import') }}
      </DcButton>
    </template>

    <div class="flex w-full flex-col gap-4">
      <SystemPromptSettingsSection @dirty-change="systemPromptDirty = $event" />
      <Separator />
      <CustomPromptSettingsSection
        ref="customPromptSection"
        :blocked="systemPromptDirty"
        @ready-change="customPromptsReady = $event"
      />
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Separator } from '@shadcn/components/ui/separator'
import SystemPromptSettingsSection from './prompt/SystemPromptSettingsSection.vue'
import CustomPromptSettingsSection from './prompt/CustomPromptSettingsSection.vue'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const systemPromptDirty = ref(false)
const customPromptsReady = ref(false)
const pageActionsDisabled = computed(() => systemPromptDirty.value || !customPromptsReady.value)
const customPromptSection = ref<InstanceType<typeof CustomPromptSettingsSection> | null>(null)

const handleImportPrompts = () => {
  customPromptSection.value?.importPrompts()
}

const handleExportPrompts = () => {
  customPromptSection.value?.exportPrompts()
}
</script>
