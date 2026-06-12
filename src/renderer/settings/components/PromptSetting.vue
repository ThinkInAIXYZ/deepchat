<template>
  <SettingsPageShell
    :title="t('promptSetting.title')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-prompt-page"
  >
    <template #actions>
      <Button variant="outline" size="sm" @click="handleExportPrompts">
        <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.export') }}
      </Button>
      <Button variant="outline" size="sm" @click="handleImportPrompts">
        <Icon icon="lucide:upload" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.import') }}
      </Button>
    </template>

    <div class="flex w-full flex-col gap-4">
      <SystemPromptSettingsSection />
      <Separator />
      <CustomPromptSettingsSection ref="customPromptSection" />
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Separator } from '@shadcn/components/ui/separator'
import SystemPromptSettingsSection from './prompt/SystemPromptSettingsSection.vue'
import CustomPromptSettingsSection from './prompt/CustomPromptSettingsSection.vue'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const customPromptSection = ref<InstanceType<typeof CustomPromptSettingsSection> | null>(null)

const handleImportPrompts = () => {
  customPromptSection.value?.importPrompts()
}

const handleExportPrompts = () => {
  customPromptSection.value?.exportPrompts()
}
</script>
